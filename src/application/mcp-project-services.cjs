const { McpStore } = require("../storage/mcp-store.cjs");
const { accountError } = require("../domain/account.cjs");
const { mcpId, assertMcpScope } = require("../domain/mcp-access.cjs");
const { pageInput, revision, contentFields, assignmentFields, responsibilityFields } = require("../domain/project-issues.cjs");
const { projectFileInput, previewMimeType } = require("../domain/project-files.cjs");
const { presentMcpProject, presentMcpMember, presentMcpUpload, presentMcpIssue, presentMcpIssueResult } = require("./mcp-presenter.cjs");

const markdownFields = ["description", "acceptanceCriteria", "reproductionSteps", "expectedResult", "actualResult"];
const writeScopes = { create_release: "releases.write", create_issue: "issues.write", update_issue: "issues.write", assign_issue: "issues.assign" };
class McpProjectServices {
  constructor(database, { tokens, projects, content, lifecycle, development, workflows }) {
    this.store = new McpStore(database);
    Object.assign(this, { tokens, projects, content, lifecycle, development, workflows });
  }
  async authorize(context, projectId, permission = "issue.view", scope = "read") {
    const token = await this.tokens.refresh(context, scope, projectId);
    return this.projects.authorize(projectId, { id: token.userId }, permission);
  }
  async read(context, projectId, operation, permission = "issue.view") {
    await this.authorize(context, projectId, permission);
    const result = await operation();
    await this.authorize(context, projectId, permission);
    return result;
  }
  async listProjects(context, input) {
    const token = await this.tokens.refresh(context);
    const { limit, offset, query } = pageInput(input);
    const projects = (await this.projects.list({ id: token.userId })).projects.filter(project =>
      (token.allProjects || token.projectIds.includes(project.id)) && (!query || project.name.toLowerCase().includes(query.toLowerCase())));
    await this.tokens.refresh(context);
    return { items: projects.slice(offset, offset + limit).map(presentMcpProject),
      nextOffset: offset + limit < projects.length ? offset + limit : null };
  }
  async listReleases(context, input) {
    const { limit, offset } = pageInput(input);
    const token = await this.tokens.refresh(context);
    const ids = input.projectIds || (await this.projects.list({ id: token.userId })).projects
      .filter(project => (token.allProjects || token.projectIds.includes(project.id)) && project.permissions.includes("issue.view")).map(project => project.id);
    const items = [];
    for (const projectId of ids) {
      const releases = await this.read(context, projectId, () => this.lifecycle.listReleases(projectId, { id: token.userId }, { includeArchived: input.status === "active" ? "false" : "true" }));
      items.push(...releases.items.filter(release => input.status === "all" || release.status === input.status));
    }
    await this.tokens.refresh(context);
    return { items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null };
  }
  async members(context, input) {
    const { limit, offset, query } = pageInput(input);
    return this.read(context, input.projectId, async () => {
      const rows = (await this.projects.members(input.projectId, { id: context.userId })).members.map(presentMcpMember)
        .filter(member => member.active && (!input.assignableOnly || member.canAssign) &&
          (!query || (member.displayName + " " + member.username).toLowerCase().includes(query.toLowerCase())));
      return { items: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null };
    }, "project.view");
  }
  async searchIssues(context, { projectId, ...input }) {
    return this.read(context, projectId, async () => {
      const result = await this.content.listIssues(projectId, { id: context.userId }, { ...input, includeArchived: String(input.includeArchived || false) });
      return { ...result, items: result.items.map(presentMcpIssue) };
    });
  }
  async issueResult(projectId, id, actor) {
    const issue = await this.content.readIssue(projectId, id, actor);
    let task = null;
    if (issue.development) {
      task = (await this.development.read(projectId, issue.development.taskId, actor)).task;
    }
    return presentMcpIssueResult(issue, task, (await this.content.listFiles(projectId, "issues", id, actor, { limit: 100 })).items);
  }
  async getIssue(context, input) {
    return this.read(context, input.projectId, () => this.issueResult(input.projectId, input.issueId, { id: context.userId }));
  }
  async getIssueWorkflow(context, input) {
    return this.read(context, input.projectId, () => this.workflows.readPublished(input.projectId, input.type, { id: context.userId }));
  }
  async upload(context, projectId, requestId, input) {
    mcpId(projectId, "项目 ID"); mcpId(requestId);
    const file = projectFileInput(input);
    return this.store.transaction(async () => {
      const token = await this.tokens.refreshUpload(context, projectId);
      const result = await this.store.upload(token.userId, projectId, requestId, file);
      await this.tokens.refreshUpload(context, projectId);
      await this.store.audit(token.userId, token.id, "upload", projectId, requestId);
      return presentMcpUpload(result, previewMimeType(file.data));
    });
  }
  async write(context, kind, input, permissions, operation) {
    const requestId = mcpId(input.requestId), projectId = mcpId(input.projectId, "项目 ID");
    const scope = writeScopes[kind], inputHash = this.store.hash(input);
    return this.store.transaction(async () => {
      const token = await this.tokens.refresh(context, scope, projectId);
      const actor = { id: token.userId };
      const authorize = async () => {
        const current = await this.authorize(context, projectId, "issue.view", scope);
        if (permissions.includes("issue.assign")) assertMcpScope(await this.tokens.refresh(context), "issues.assign", projectId);
        if (permissions.some(permission => !current.permissions.includes(permission)))
          throw accountError("当前账号没有此项目操作权限。", 403);
      };
      await authorize();
      const existing = await this.store.operation(actor.id, requestId);
      if (existing) {
        if (existing.kind !== kind || existing.projectId !== projectId || existing.inputHash !== inputHash)
          throw accountError("相同请求标识不能提交不同操作或参数。", 409, "MCP_REQUEST_CONFLICT");
        return { ...existing.result, reused: true };
      }
      const result = await operation(actor);
      await authorize();
      await this.store.saveOperation({ userId: actor.id, requestId, projectId, kind, inputHash, result });
      await this.store.audit(actor.id, token.id, kind, projectId, requestId);
      return { ...result, reused: false };
    });
  }
  async createRelease(context, input) {
    return this.write(context, "create_release", input, ["release.manage"], async actor =>
      ({ release: await this.lifecycle.saveRelease(input.projectId, null, actor, { name: input.name, description: input.description || "",
        ...(Object.hasOwn(input, "targetDate") ? { targetDate: input.targetDate } : {}) }) }));
  }
  async issueInput(actor, projectId, input, issueId) {
    const ids = (input.attachmentIds || []).map(id => mcpId(id, "附件 ID"));
    if (ids.length > 20 || new Set(ids).size !== ids.length) throw accountError("附件最多 20 个且不能重复。", 400);
    const files = await this.store.attachments(actor.id, projectId, ids, issueId);
    const value = { ...input };
    for (const key of ["projectId", "issueId", "attachmentIds", "developerId"]) delete value[key];
    if (issueId) delete value.requestId;
    for (const field of markdownFields) if (typeof value[field] === "string") {
      value[field] = value[field].replace(/attachment:([a-zA-Z0-9_-]+)/g, (_match, id) => {
        if (!ids.includes(id)) throw accountError("正文中的附件引用必须包含在 attachmentIds 中。", 400);
        return "/api/projects/" + projectId + "/files/" + id;
      });
    }
    if (files.length) value.attachments = files.map(file => ({ ...file, data: file.data.toString("base64") }));
    return { value, ids };
  }
  async createIssue(context, input) {
    const assigns = Boolean(input.developerId || input.watcherIds?.length || responsibilityFields.some(key => input[key] && input[key] !== context.userId));
    return this.write(context, "create_issue", input, ["issue.create", ...(assigns ? ["issue.assign"] : [])], async actor => {
      const { value, ids } = await this.issueInput(actor, input.projectId, input);
      const issue = await this.content.createIssue(input.projectId, actor, value);
      if (input.developerId) await this.development.create(input.projectId, actor, { requestId: input.requestId, issueIds: [issue.id], executorId: input.developerId });
      await this.store.bind(ids, issue.id);
      return this.issueResult(input.projectId, issue.id, actor);
    });
  }
  async updateIssue(context, input) {
    const permissions = [
      ...(input.attachmentIds?.length || contentFields.some(key => Object.hasOwn(input, key)) ? ["issue.edit"] : []),
      ...(assignmentFields.some(key => Object.hasOwn(input, key)) ? ["issue.assign"] : []),
    ];
    return this.write(context, "update_issue", input, permissions, async actor => {
      const { value, ids } = await this.issueInput(actor, input.projectId, input, input.issueId);
      await this.content.updateIssue(input.projectId, input.issueId, actor, value);
      await this.store.bind(ids, input.issueId);
      return this.issueResult(input.projectId, input.issueId, actor);
    });
  }
  async assignIssue(context, input) {
    return this.write(context, "assign_issue", input, ["issue.assign"], async actor => {
      let issue = await this.content.readIssue(input.projectId, input.issueId, actor);
      if (issue.revision !== revision(input.revision)) throw accountError("事项已修改，请重新读取后再指派。", 409);
      if (input.watcherIds) issue = await this.content.updateIssue(input.projectId, issue.id, actor, { revision: issue.revision, watcherIds: input.watcherIds });
      if (issue.development) {
        const { task } = await this.development.read(input.projectId, issue.development.taskId, actor);
        if (task.issueIds.length !== 1) throw accountError("事项属于合并开发任务，请在控制台确认整个任务的转派范围。", 409);
        await this.development.update(input.projectId, task.id, actor, { revision: input.taskRevision, executorId: input.developerId });
      } else {
        await this.development.create(input.projectId, actor, { requestId: input.requestId, issueIds: [issue.id], executorId: input.developerId });
      }
      return this.issueResult(input.projectId, issue.id, actor);
    });
  }
  async requestResult(context, input) {
    return this.read(context, input.projectId, async () => {
      const saved = await this.store.operation(context.userId, mcpId(input.requestId));
      if (!saved || saved.projectId !== input.projectId) throw accountError("未找到已成功提交的请求；可使用原标识和原参数重试。", 404);
      return { operation: saved.kind, ...saved.result, reused: true };
    });
  }
}
module.exports = { McpProjectServices };
