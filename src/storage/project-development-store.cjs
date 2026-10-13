const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { accountError } = require("../domain/account.cjs");
const { runKey } = require("../domain/run-identity.cjs");
const { ProjectContentStore } = require("./project-content-store.cjs");

function missing() { return accountError("开发任务不存在。", 404); }
function conflict() { return accountError("开发任务已变更，请刷新后重试。", 409); }
function json(value) { return JSON.parse(JSON.stringify(value)); }

class ProjectDevelopmentStore {
  constructor(database) { this.database = database; }
  async transaction(operation) {
    try { return await this.database.transaction(operation); }
    catch (error) { if (["P2002", "P2034"].includes(error.code)) throw conflict(); throw error; }
  }
  async space(projectId, userId) {
    const space = await this.database.client.developmentSpace.findUnique({ where: { projectId_userId: { projectId, userId } } });
    if (!space || space.status !== "ready" || !space.workspaceId || !space.gitAccountId)
      throw accountError("请先配置个人 Git 并准备当前项目的开发空间。", 409);
    const account = await this.database.client.gitAccount.findFirst({ where: { id: space.gitAccountId, userId } });
    if (!account) throw accountError("开发空间的 Git 账号已失效，请检查配置。", 409);
    return space;
  }
  async issues(projectId, ids) {
    const rows = await this.database.client.projectIssue.findMany({ where: { projectId, id: { in: ids } }, include: {
      release: true, workflowVersion: true,
      source: { select: { channel: true, scope: true, type: true, externalId: true, url: true } },
      files: { select: { id: true, name: true, mimeType: true, size: true, sha256: true } },
    } });
    if (rows.length !== ids.length) throw accountError("事项不存在或不属于当前项目。", 404);
    return ids.map(id => json(rows.find(row => row.id === id)));
  }
  async task(projectId, id) {
    const task = await this.database.client.developmentTask.findFirst({ where: { projectId, id }, include: { executor: { select: { id: true, displayName: true } }, release: true } });
    if (!task) throw missing();
    return task;
  }
  async existing(projectId, creatorId, requestId) {
    return this.database.client.developmentTask.findUnique({ where: { projectId_creatorId_requestId: { projectId, creatorId, requestId } }, include: { executor: { select: { id: true, displayName: true } }, release: true } });
  }
  async assignmentBatch(projectId, creatorId, requestId) {
    return this.database.client.developmentTask.findMany({ where: { projectId, creatorId, requestId: { startsWith: `${requestId}:` } }, include: { executor: { select: { id: true, displayName: true } }, release: true }, orderBy: { createdAt: "asc" } });
  }
  sameAssignment(tasks, request) {
    if (tasks.length !== request.issueIds.length || tasks.some(task => !isDeepStrictEqual(task.snapshot.request.assignmentRequest, request))) throw accountError("相同请求标识不能提交不同事项或执行人。", 409);
  }
  async assign(projectId, actorId, request, issues) {
    const tasks = [];
    for (const issue of issues) tasks.push(await this.create(projectId, actorId, { ...request, requestId: `${request.requestId}:${issue.id}`, assignmentRequest: request }, [issue]));
    return tasks;
  }
  async assignIssues(projectId, issues, executorId, actorId) {
    const content = new ProjectContentStore(this.database);
    for (const issue of issues) if (issue.assigneeId !== executorId) await content.updateIssue(projectId, issue.id, actorId, issue.revision, { assigneeId: executorId }, "assigned");
    return this.issues(projectId, issues.map(issue => issue.id));
  }
  sameRequest(task, input) {
    if (!isDeepStrictEqual(task.snapshot.request, input)) throw accountError("相同请求标识不能提交不同事项或执行选项。", 409);
  }
  async create(projectId, actorId, request, issues) {
    issues = await this.assignIssues(projectId, issues, request.executorId, actorId);
    const id = randomUUID();
    const task = await this.database.client.developmentTask.create({ data: { id, projectId, creatorId: actorId, executorId: request.executorId, releaseId: issues[0].releaseId,
      requestId: request.requestId, status: "planned",
      snapshot: json({ request, title: issues[0].title, issues, additions: [] }) } });
    await this.database.client.taskIssueLink.createMany({ data: issues.map(issue => ({ projectId, taskId: id, issueId: issue.id, snapshot: issue })) });
    await this.claim(task, issues);
    await this.audit(actorId, "development.planned", projectId, id);
    return this.task(projectId, id);
  }
  async merge(projectId, actorId, request, tasks, issues) {
    const id = randomUUID();
    for (const task of tasks) await this.update(task, { status: "merged", snapshot: json({ ...task.snapshot, mergedIntoTaskId: id }) });
    await this.database.client.issueDevelopmentClaim.deleteMany({ where: { projectId, taskId: { in: tasks.map(task => task.id) } } });
    const task = await this.database.client.developmentTask.create({ data: { id, projectId, creatorId: actorId, executorId: actorId, releaseId: tasks[0].releaseId,
      requestId: request.requestId, snapshot: json({ request, title: request.title, issues, additions: [], mergedFromTaskIds: tasks.map(task => task.id) }) } });
    await this.database.client.taskIssueLink.createMany({ data: issues.map(issue => ({ projectId, taskId: id, issueId: issue.id, snapshot: issue })) });
    await this.claim(task, issues);
    await this.audit(actorId, "development.merged", projectId, id);
    return this.task(projectId, id);
  }
  async claim(task, issues) {
    await this.database.client.issueDevelopmentClaim.createMany({ data: issues.map(issue => ({ projectId: task.projectId, taskId: task.id, issueId: issue.id })) });
  }
  async replacePlan(task, request, issues, actorId) {
    const removed = task.snapshot.issues.filter(issue => !issues.some(next => next.id === issue.id));
    if (removed.length) await this.assignIssues(task.projectId, await this.issues(task.projectId, removed.map(issue => issue.id)), null, actorId);
    issues = await this.assignIssues(task.projectId, issues, request.executorId ?? task.executorId, actorId);
    const updated = await this.update(task, { executorId: request.executorId ?? task.executorId, releaseId: issues[0].releaseId,
      snapshot: json({ ...task.snapshot, title: request.title ?? task.snapshot.title, issues }) });
    await this.database.client.issueDevelopmentClaim.deleteMany({ where: { taskId: task.id } });
    await this.database.client.taskIssueLink.deleteMany({ where: { taskId: task.id } });
    await this.database.client.taskIssueLink.createMany({ data: issues.map(issue => ({ projectId: task.projectId, taskId: task.id, issueId: issue.id, snapshot: issue })) });
    await this.claim(updated, issues);
    return updated;
  }
  async acceptStart(task, space, request, issues, prompt, selection) {
    for (const issue of issues) await this.database.client.taskIssueLink.update({ where: { taskId_issueId: { taskId: task.id, issueId: issue.id } }, data: { snapshot: issue } });
    return this.update(task, { spaceId: space.id, workspaceId: space.workspaceId, runKey: runKey({ channel: "manual", scope: "local", id: task.id }), status: "unknown",
      snapshot: json({ ...task.snapshot, issues, prompt, selection, supplementaryPrompt: request.supplementaryPrompt || "", baseBranch: request.baseBranch, startRequest: request }) });
  }
  async acceptManual(projectId, actorId, space, request, prompt, selection) {
    const id = randomUUID();
    await this.database.client.developmentTask.create({ data: { id, projectId, creatorId: actorId, executorId: actorId,
      spaceId: space.id, workspaceId: space.workspaceId, requestId: request.requestId,
      runKey: runKey({ channel: "manual", scope: "local", id }), status: "unknown",
      snapshot: json({ kind: "manual", request, title: request.title, manual: { content: request.content, images: request.images, taskType: request.taskType },
        issues: [], additions: [], prompt, selection, baseBranch: request.baseBranch, startRequest: request }) } });
    await this.audit(actorId, "development.manual.accepted", projectId, id);
    return this.task(projectId, id);
  }
  async finish(task, status, actorId) {
    if (status === "cancelled") await this.assignIssues(task.projectId, await this.issues(task.projectId, [...task.snapshot.issues.map(issue => issue.id), ...task.snapshot.additions.flatMap(batch => batch.issueIds)]), null, actorId);
    const updated = await this.update(task, { status });
    await this.database.client.issueDevelopmentClaim.deleteMany({ where: { taskId: task.id } });
    await this.audit(actorId, `development.${status}`, task.projectId, task.id);
    return updated;
  }
  async update(task, data) {
    if (!(await this.database.client.developmentTask.updateMany({ where: { id: task.id, projectId: task.projectId, revision: task.revision }, data: { ...data, revision: { increment: 1 } } })).count) throw conflict();
    return this.task(task.projectId, task.id);
  }
  async list(projectId, { limit, offset, issueId, executorId }) {
    if (issueId && !await this.database.client.projectIssue.findFirst({ where: { projectId, id: issueId }, select: { id: true } }))
      throw accountError("事项不存在或不属于当前项目。", 404);
    const rows = await this.database.client.developmentTask.findMany({ where: { projectId, ...(executorId ? { executorId } : {}), ...(!issueId ? { status: { not: "merged" } } : {}), ...(issueId ? { issueLinks: { some: { projectId, issueId } } } : {}) }, include: { executor: { select: { id: true, displayName: true } }, release: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit + 1 });
    return { tasks: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }
  async addIssues(task, input, issues, prompt) {
    const batches = task.snapshot.additions || [];
    const existing = batches.find(batch => batch.requestId === input.requestId);
    if (existing) {
      if (!isDeepStrictEqual(existing.issueIds, input.issueIds)) throw accountError("相同追加标识不能提交不同事项。", 409);
      return { task, batch: existing, reused: true };
    }
    const linked = await this.database.client.taskIssueLink.findMany({ where: { taskId: task.id }, select: { issueId: true } });
    if (linked.some(link => input.issueIds.includes(link.issueId))) throw accountError("所选事项已关联当前任务。", 409);
    if (linked.length + input.issueIds.length > 20) throw accountError("一个开发任务最多融合 20 条事项。", 400);
    const batch = { requestId: input.requestId, issueIds: input.issueIds, issues, prompt, status: "ready", createdAt: new Date().toISOString() };
    const updated = await this.update(task, { snapshot: json({ ...task.snapshot, additions: [...batches, batch] }) });
    await this.database.client.taskIssueLink.createMany({ data: issues.map(issue => ({ projectId: task.projectId, taskId: task.id, issueId: issue.id, snapshot: issue })) });
    await this.claim(task, issues);
    await this.audit(task.executorId, "development.issues.added", task.projectId, task.id);
    return { task: updated, batch, reused: false };
  }
  async updateBatch(task, requestId, patch, expectedStatus) {
    const batch = task.snapshot.additions.find(entry => entry.requestId === requestId);
    if (!batch) throw accountError("追加资料不存在。", 404);
    if (expectedStatus && batch.status !== expectedStatus) throw accountError("此批资料已发送或结果不确定，不能重复执行。", 409);
    const updated = { ...batch, ...patch };
    return this.update(task, { snapshot: json({ ...task.snapshot, additions: task.snapshot.additions.map(entry => entry.requestId === requestId ? updated : entry) }) });
  }
  async issueImage(projectId, issueId, fileId) {
    const file = await this.database.client.projectFile.findFirst({ where: { id: fileId, projectId, issueId, assetId: null } });
    if (!file) throw accountError("事项图片不存在或不属于当前事项。", 404);
    return Buffer.from(file.data);
  }
  async execution(task) {
    if (!task.runKey) return null;
    const run = await this.database.readDocument(path.join(this.database.dataRoot, "workspaces", task.workspaceId, "runs", task.runKey, "run.json"));
    return run ? { status: run.execution?.status || "unknown", error: run.execution?.error || null, sessionId: run.session_id || null, baseline: run.worktree?.baseline || null } : null;
  }
  async taskForRun(workspaceId, runKey) {
    return this.database.client.developmentTask.findUnique({ where: { workspaceId_runKey: { workspaceId, runKey } }, include: { release: true } });
  }
  async audit(actorId, event, projectId, taskId) {
    return this.database.client.auditEvent.create({ data: { actorUserId: actorId, event, details: { projectId, taskId } } });
  }
}

module.exports = { ProjectDevelopmentStore };
