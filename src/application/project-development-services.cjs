const { isDeepStrictEqual } = require("node:util");
const { ProjectDevelopmentStore } = require("../storage/project-development-store.cjs");
const { AccountStore } = require("../storage/account-store.cjs");
const { developmentStatus, developmentInput, developmentMergeInput, developmentStartInput, manualDevelopmentInput, manualDevelopmentPrompt, developmentEditInput, developmentPrompt } = require("../domain/project-development.cjs");
const { issueDevelopmentAllowed, assertIssueWritable } = require("../domain/issue-workflows.cjs");
const { pageInput, identifier, object, revision } = require("../domain/project-issues.cjs");
const { accountError } = require("../domain/account.cjs");
const { presentError } = require("./error-presenter.cjs");
const { ProjectWorkflowServices } = require("./project-workflow-services.cjs");
const { issueWorkflowNode } = require("../domain/issue-workflows.cjs");
const { WorkflowExecutionServices } = require("./workflow-execution-services.cjs");
const { presentDevelopment } = require("./project-development-presenter.cjs");
const { isImageAttachment } = require("../domain/attachment-prompts.cjs");
const { developmentReworkInput } = require("../domain/project-development.cjs");
const { reworkAvailable, reworkPrompt } = require("../domain/development-lifecycle.cjs");

class ProjectDevelopmentServices {
  constructor(database, projects, workspaces) {
    this.store = new ProjectDevelopmentStore(database);
    this.accounts = new AccountStore(database);
    this.projects = projects;
    this.workspaces = workspaces;
    this.starting = new Set();
    this.workflow = new ProjectWorkflowServices(database, projects);
    this.workflowExecution = new WorkflowExecutionServices(database, projects);
  }
  async authorize(projectId, actor, permission) {
    await this.projects.authorize(projectId, actor, "issue.view");
    return this.projects.authorize(projectId, actor, permission);
  }
  async present(task, actor, detail = false) {
    await this.workflowExecution.recoverTask(task);
    task = await this.store.task(task.projectId, task.id);
    const execution = await this.store.execution(task);
    const { permissions, project } = await this.authorize(task.projectId, actor, "issue.view");
    return presentDevelopment(task, actor.id, execution, { detail, permissions, projectStatus: project.status });
  }
  async list(projectId, actor, input = {}) {
    await this.authorize(projectId, actor, "issue.view");
    if (input.scope && !["mine", "all"].includes(input.scope)) throw accountError("任务范围无效。", 400);
    const page = await this.store.list(projectId, { ...pageInput(input), status: developmentStatus(input.status), ...(input.scope === "mine" ? { executorId: actor.id } : {}), ...(input.issueId ? { issueId: identifier(input.issueId, "事项") } : {}) });
    const tasks = await Promise.all(page.tasks.map(task => this.present(task, actor)));
    await this.authorize(projectId, actor, "issue.view");
    return { tasks, nextOffset: page.nextOffset };
  }
  async read(projectId, id, actor) {
    await this.authorize(projectId, actor, "issue.view");
    const task = await this.present(await this.store.task(projectId, id), actor, true);
    await this.authorize(projectId, actor, "issue.view");
    return { task };
  }
  async retryWorkflow(projectId, id, actor, input) {
    object(input, ["revision"]); revision(input.revision);
    await this.authorize(projectId, actor, "session.start");
    const task = await this.store.task(projectId, id);
    if (task.executorId !== actor.id || task.revision !== input.revision) throw accountError("任务归属或修订已变化。", 409);
    await this.workflowExecution.recoverTask(task, true);
    return this.read(projectId, id, actor);
  }
  async rework(projectId, id, actor, input) {
    const request = { ...developmentReworkInput(input), sourceTaskId: id, executorId: actor.id };
    const accepted = await this.store.transaction(async () => {
      await this.authorizePlan(projectId, actor, actor.id);
      await this.authorize(projectId, actor, "collaboration.view");
      const existing = await this.store.existing(projectId, actor.id, request.requestId);
      if (existing) { this.store.sameRequest(existing, request); return { task: existing, reused: true }; }
      const task = await this.store.task(projectId, id);
      if (task.executorId !== actor.id) throw accountError("只有原任务执行人能创建返工任务。", 403);
      this.assertRevision(task, request.revision);
      const execution = await this.store.execution(task);
      if (!reworkAvailable(task, execution)) throw accountError("仅工作目录已清理且有退回交付的任务可以创建返工任务。", 409);
      const returned = task.issueLinks.flatMap(({ issue }) => issue.deliverables || []).filter(delivery => delivery.status === "returned");
      if (returned.some(delivery => delivery.authorId !== actor.id) || !isDeepStrictEqual(returned.map(({ id, revision }) => ({ id, revision })).sort((a, b) => a.id.localeCompare(b.id)), request.deliveries))
        throw accountError("退回交付已变化，请刷新后重新确认。", 409);
      const issues = await this.store.issues(projectId, task.issueLinks.map(link => link.issueId));
      this.assertIssues(issues, task.releaseId);
      if (!issues.some(issueDevelopmentAllowed)) throw accountError("事项当前流程不允许返工开发。", 409);
      return { task: await this.store.replaceForRework(task, actor.id, request), reused: false };
    });
    return { task: await this.present(accepted.task, actor, true), reused: accepted.reused };
  }
  async readSession(projectId, actor, input) {
    await this.authorize(projectId, actor, "session.view");
    if (typeof input.runKey !== "string" || !input.runKey || input.runKey.length > 200) throw accountError("会话标识无效。", 400);
    const task = await this.present(await this.store.taskForSession(projectId, actor.id, input.runKey), actor, true);
    await this.authorize(projectId, actor, "session.view");
    return { task };
  }
  async images(projectId, issues) {
    const images = issues.flatMap(issue => (issue.files || []).filter(isImageAttachment).map(file => ({ ...file, issueId: issue.id })));
    if (images.length > 20) throw accountError("所选事项图片合计超过 20 张，请拆分开发任务。", 400);
    const values = [];
    for (const file of images) values.push(await this.store.issueImage(projectId, file.issueId, file.id));
    return values;
  }
  async authorizePlan(projectId, actor, executorId) {
    await this.authorize(projectId, actor, executorId === actor.id ? "session.start" : "issue.assign");
    const context = await this.authorize(projectId, { id: executorId }, "session.start");
    if (context.user.role !== "admin" && context.membership?.status !== "active") throw accountError("执行人必须是具备开发资格的有效项目成员。", 403);
  }
  assertIssues(issues, releaseId, start = false) {
    for (const issue of issues) {
      assertIssueWritable(issue);
      if (issue.releaseId !== releaseId) throw accountError("一个开发任务只能关联同一发布版本的事项。", 409);
      if (start && !issueDevelopmentAllowed(issue)) throw accountError("事项当前流程节点不允许开发，请先完成业务流转。", 409);
    }
  }
  assertRevision(task, expected) {
    if (task.revision !== expected) throw accountError("开发任务已变更，请刷新后重试。", 409);
  }
  async create(projectId, actor, input) {
    const request = { ...developmentInput(input), executorId: input.executorId || actor.id };
    const accepted = await this.store.transaction(async () => {
      await this.authorizePlan(projectId, actor, request.executorId);
      const existing = await this.store.assignmentBatch(projectId, actor.id, request.requestId);
      if (existing.length) { this.store.sameAssignment(existing, request); return { tasks: existing, reused: true }; }
      const issues = await this.store.issues(projectId, request.issueIds);
      for (const issue of issues) {
        this.assertIssues([issue], issue.releaseId);
        if (!issueWorkflowNode(issue).allowAssignment) throw accountError("当前节点不允许认领或指派，请先完成前置流程。", 409);
      }
      const tasks = await this.store.assign(projectId, actor.id, request, issues);
      for (const issue of await this.store.issues(projectId, request.issueIds)) {
        if (issueWorkflowNode(issue).handler !== "developer" || issue.workflowVersion.definition.transitions.some(edge => edge.from === issue.status && edge.trigger === "development.assigned")) await this.workflow.event(issue, actor, "development.assigned", { executorId: request.executorId });
      }
      return { tasks, reused: false };
    });
    return { tasks: await Promise.all(accepted.tasks.map(task => this.present(task, actor, true))), reused: accepted.reused };
  }
  async merge(projectId, actor, input) {
    const request = developmentMergeInput(input);
    const accepted = await this.store.transaction(async () => {
      await this.authorizePlan(projectId, actor, actor.id);
      const existing = await this.store.existing(projectId, actor.id, request.requestId);
      if (existing) { this.store.sameRequest(existing, request); return { task: existing, reused: true }; }
      const tasks = [];
      for (const entry of request.tasks) {
        const task = await this.store.task(projectId, entry.id);
        this.assertRevision(task, entry.revision);
        if (task.executorId !== actor.id) throw accountError("只能合并自己的开发任务。", 403);
        if (task.status !== "planned" || task.runKey) throw accountError("只能合并尚未启动的待开发任务。", 409);
        if (task.issueLinks.some(link => link.issue.deliverables?.length)) throw accountError("已有交付记录的任务不能合并，请保留原交付来源。", 409);
        tasks.push(task);
      }
      if (tasks.some(task => task.releaseId !== tasks[0].releaseId)) throw accountError("只能合并同一发布版本的开发任务。", 409);
      const ids = tasks.flatMap(task => task.snapshot.issues.map(issue => issue.id));
      if (ids.length > 20) throw accountError("合并后的任务最多包含 20 条事项。", 400);
      const issues = await this.store.issues(projectId, ids);
      this.assertIssues(issues, tasks[0].releaseId);
      return { task: await this.store.merge(projectId, actor.id, request, tasks, issues), reused: false };
    });
    return { task: await this.present(accepted.task, actor, true), reused: accepted.reused };
  }
  async update(projectId, id, actor, input) {
    const request = developmentEditInput(input);
    await this.authorize(projectId, actor, "issue.view");
    const task = await this.store.transaction(async () => {
      const current = await this.store.task(projectId, id);
      await this.authorize(projectId, actor, current.executorId === actor.id ? "session.start" : "issue.assign");
      this.assertRevision(current, request.revision);
      if (current.status !== "planned") throw accountError("仅未启动的开发任务可编辑或重新指派。", 409);
      if (current.issueLinks.some(link => link.issue.deliverables?.[0]?.status === "pending")) throw accountError("关联事项正在验证，请先完成本轮验证再修改任务范围或执行人。", 409);
      if (request.executorId && request.executorId !== current.executorId) {
        await this.authorize(projectId, actor, "issue.assign");
        await this.authorizePlan(projectId, actor, request.executorId);
      }
      const issues = await this.store.issues(projectId, request.issueIds || current.snapshot.issues.map(issue => issue.id));
      this.assertIssues(issues, current.releaseId);
      const added = issues.filter(issue => !current.snapshot.issues.some(previous => previous.id === issue.id));
      if (added.some(issue => !issueWorkflowNode(issue).allowAssignment)) throw accountError("新增事项当前不允许认领或指派。", 409);
      const saved = await this.store.replacePlan(current, request, issues, actor.id);
      for (const issue of await this.store.issues(projectId, added.map(issue => issue.id))) {
        if (issueWorkflowNode(issue).handler !== "developer" || issue.workflowVersion.definition.transitions.some(edge => edge.from === issue.status && edge.trigger === "development.assigned")) await this.workflow.event(issue, actor, "development.assigned", { executorId: saved.executorId });
      }
      return saved;
    });
    return { task: await this.present(task, actor, true) };
  }
  async start(projectId, id, actor, input) {
    const request = developmentStartInput(input);
    const prepared = await this.store.transaction(async () => {
      await this.authorize(projectId, actor, "session.start");
      const current = await this.store.task(projectId, id);
      if (current.executorId !== actor.id) throw accountError("只有任务执行人能开始开发。", 403);
      if (current.snapshot.reworkOfTaskId) await this.authorize(projectId, actor, "collaboration.view");
      if (current.snapshot.startRequest) {
        if (!isDeepStrictEqual(current.snapshot.startRequest, request)) throw accountError("任务已接受启动请求，不能修改参数或再次启动。", 409);
        return { task: current, created: false };
      }
      this.assertRevision(current, request.revision);
      if (current.status !== "planned") throw accountError("仅待开发任务可以启动。", 409);
      const space = await this.store.space(projectId, actor.id);
      const allIssues = await this.store.issues(projectId, current.snapshot.issues.map(issue => issue.id));
      this.assertIssues(allIssues, current.releaseId);
      const issues = allIssues.filter(issueDevelopmentAllowed);
      if (!issues.length) throw accountError("关联事项当前流程节点不允许开发，请先完成业务流转。", 409);
      this.assertIssues(issues, current.releaseId, true);
      const prompt = developmentPrompt(issues, false, await this.projects.effectivePrompts(projectId, actor), {
        title: current.snapshot.title, content: [reworkPrompt(current, issues), request.supplementaryPrompt].filter(Boolean).join("\n\n"),
      }, this.store.attachmentPaths(current, issues));
      const defaults = await this.accounts.settings(actor.id);
      const selection = Object.fromEntries(["model", "reasoningEffort", "permissionMode"].map(field => [field,
        Object.hasOwn(request, field) ? request[field] : defaults[field] ?? ""]));
      return { task: current, space, issues, prompt, selection, created: true };
    });
    if (!prepared.created) return { task: await this.present(prepared.task, actor, true), reused: true };
    // Validate and stage inputs without freezing the plan or holding a database transaction.
    const context = await this.workspaces.get(prepared.space.workspaceId, actor);
    const selection = await context.sessions.validateStartSelection(prepared.selection);
    await this.store.materializeAttachments(prepared.task, prepared.issues);
    await this.authorize(projectId, actor, "session.start");
    const imageIds = [];
    for (const bytes of await this.images(projectId, prepared.issues)) {
      await this.authorize(projectId, actor, "session.start");
      imageIds.push((await context.channels.get("manual").uploadImage(bytes)).id);
    }
    await context.channels.get("manual").resolve({ requestId: id, title: prepared.task.snapshot.title,
      content: prepared.prompt, renderedPrompt: true, images: imageIds });
    const accepted = await this.store.transaction(async () => {
      await this.authorize(projectId, actor, "session.start");
      const current = await this.store.task(projectId, id);
      if (current.executorId !== actor.id) throw accountError("只有任务执行人能开始开发。", 403);
      if (current.snapshot.reworkOfTaskId) await this.authorize(projectId, actor, "collaboration.view");
      if (current.snapshot.startRequest) {
        if (!isDeepStrictEqual(current.snapshot.startRequest, request)) throw accountError("任务已接受启动请求，不能修改参数或再次启动。", 409);
        return { task: current, created: false };
      }
      this.assertRevision(current, request.revision);
      if (current.status !== "planned") throw accountError("仅待开发任务可以启动。", 409);
      const space = await this.store.space(projectId, actor.id);
      const allIssues = await this.store.issues(projectId, current.snapshot.issues.map(issue => issue.id));
      this.assertIssues(allIssues, current.releaseId);
      const issues = allIssues.filter(issueDevelopmentAllowed);
      if (!issues.length) throw accountError("关联事项当前流程节点不允许开发，请先完成业务流转。", 409);
      this.assertIssues(issues, current.releaseId, true);
      if (!isDeepStrictEqual(space, prepared.space) || !isDeepStrictEqual(issues, prepared.issues))
        throw accountError("开发空间或事项资料已变化，请刷新后重新开始开发。", 409);
      const task = await this.store.acceptStart(current, space, request, issues, prepared.prompt, selection);
      await this.workflowExecution.prepare(task, actor);
      return { task, created: true };
    });
    if (!accepted.created) return { task: await this.present(accepted.task, actor, true), reused: true };
    return this.launchAccepted(accepted.task, actor, { context, imageIds });
  }
  async readManual(projectId, actor, input) {
    object(input, ["requestId"]);
    const requestId = identifier(input.requestId, "开发请求");
    await this.authorize(projectId, actor, "session.start");
    const task = await this.store.existing(projectId, actor.id, requestId);
    return { task: task?.snapshot.kind === "manual" ? await this.present(task, actor, true) : null };
  }
  async startManual(projectId, actor, input) {
    const request = manualDevelopmentInput(input);
    await this.authorize(projectId, actor, "session.start");
    const existing = await this.store.existing(projectId, actor.id, request.requestId);
    if (existing) { this.store.sameRequest(existing, request); return { task: await this.present(existing, actor, true), reused: true }; }
    const space = await this.store.space(projectId, actor.id);
    const context = await this.workspaces.get(space.workspaceId, actor);
    // Validate the original input and owning workspace's uploads before accepting dispatch.
    await context.channels.get("manual").resolve({ ...request, renderedPrompt: false });
    const defaults = await this.accounts.settings(actor.id);
    const selection = await context.sessions.validateStartSelection(Object.fromEntries(["model", "reasoningEffort", "permissionMode"].map(field => [field,
      Object.hasOwn(request, field) ? request[field] : defaults[field] ?? ""])));
    const accepted = await this.store.transaction(async () => {
      await this.authorizePlan(projectId, actor, actor.id);
      const existing = await this.store.existing(projectId, actor.id, request.requestId);
      if (existing) { this.store.sameRequest(existing, request); return { task: existing, created: false }; }
      const currentSpace = await this.store.space(projectId, actor.id);
      if (currentSpace.revision !== space.revision || currentSpace.workspaceId !== space.workspaceId)
        throw accountError("开发空间已变化，请重新打开表单。", 409);
      const prompt = manualDevelopmentPrompt(request, await this.projects.effectivePrompts(projectId, actor));
      return { task: await this.store.acceptManual(projectId, actor.id, currentSpace, request, prompt, selection), created: true };
    });
    if (!accepted.created) return { task: await this.present(accepted.task, actor, true), reused: true };
    return this.launchAccepted(accepted.task, actor, { context, imageIds: request.images, returnFailure: true });
  }
  async launchAccepted(task, actor, { context, imageIds, returnFailure = false }) {
    const projectId = task.projectId;
    this.starting.add(task.id);
    try {
      await this.authorize(projectId, actor, "session.start");
      await this.store.space(projectId, actor.id);
      const started = await context.sessions.start({ channel: "manual", requestId: task.id,
        baseBranch: task.snapshot.baseBranch, title: task.snapshot.title, content: task.snapshot.prompt, renderedPrompt: true,
        images: imageIds, ...task.snapshot.selection });
      if (started.key !== task.runKey) throw new Error("开发任务与会话身份不一致，请检查已记录任务。");
      task = await this.workflowExecution.store.transaction(async () => this.store.update(await this.store.task(projectId, task.id), { status: "started" }));
    } catch (error) {
      const safe = presentError(error);
      task = await this.workflowExecution.store.transaction(async () => this.store.update(await this.store.task(projectId, task.id), { status: "unknown", error: safe.message }));
      if (!returnFailure) throw safe;
    } finally { this.starting.delete(task.id); }
    await this.authorize(projectId, actor, "session.start");
    return { task: await this.present(task, actor, true) };
  }
  assertExecutor(task, actor) {
    if (task.executorId !== actor.id) throw accountError("只能在自己的开发空间中继续会话。", 403);
    if (task.status !== "started" || !task.runKey) throw accountError("开发任务尚未开始或结果不确定，请检查原会话。", 409);
  }
  async finish(projectId, id, actor, input, status) {
    object(input, ["revision"]);
    const expected = revision(input.revision);
    await this.authorize(projectId, actor, "issue.view");
    const initial = await this.store.task(projectId, id);
    await this.authorize(projectId, actor, initial.executorId === actor.id ? "session.start" : "issue.assign");
    const save = async () => this.store.transaction(async () => {
      const task = await this.store.task(projectId, id);
      await this.authorize(projectId, actor, task.executorId === actor.id ? "session.start" : "issue.assign");
      this.assertRevision(task, expected);
      if (["completed", "cancelled", "merged"].includes(task.status)) throw accountError("开发任务已结束。", 409);
      if (status === "completed" && task.status === "planned") throw accountError("待开发任务只能取消；开始开发后才能完成。", 409);
      if (this.starting.has(task.id)) throw accountError("开发任务正在准备，请等待执行结束。", 409);
      const issues = await this.store.issues(projectId, [...task.snapshot.issues.map(issue => issue.id), ...task.snapshot.additions.flatMap(batch => batch.issueIds)]);
      this.assertIssues(issues, task.releaseId);
      if (status === "cancelled" && task.issueLinks.some(link => link.issue.deliverables?.[0]?.status === "pending")) throw accountError("交付正在验证，不能取消开发任务；请先完成本轮验证。", 409);
      if (task.runKey) {
        const execution = await this.store.execution(task);
        if (!execution || !["completed", "failed", "interrupted", "cancelled"].includes(execution.status))
          throw accountError("执行仍在进行或状态不明，请先确认原会话已结束。", 409);
      }
      if (status === "completed" && task.snapshot.kind !== "manual" && issues.some(issue => !["completed", "cancelled"].includes(issueWorkflowNode(issue).kind))) throw accountError("关联事项尚未完成验收；请提交交付并等待验证，或明确取消开发任务。", 409);
      return this.store.finish(task, status, actor.id);
    });
    let task;
    if (initial.runKey) {
      if (initial.snapshot.sessionDeletion) return { task: await this.present(await save(), actor, true) };
      const { sessions } = await this.workspaces.get(initial.workspaceId, { id: initial.executorId });
      task = await sessions.exclusive(initial.runKey, async () => {
        const reason = sessions.git.activeReason(initial.runKey);
        if (reason) throw accountError("执行仍在进行或有待处理审批，请先结束本轮。", 409);
        await sessions.git.assertIdle(initial.runKey, await sessions.store.read(initial.runKey));
        return save();
      });
    } else task = await save();
    return { task: await this.present(task, actor, true) };
  }
  async append(projectId, id, actor, input) {
    const request = developmentInput(input, true);
    await this.authorize(projectId, actor, "session.continue");
    const result = await this.store.transaction(async () => {
      await this.authorize(projectId, actor, "session.continue");
      const task = await this.store.task(projectId, id);
      if (task.snapshot.kind === "manual") throw accountError("独立开发任务不关联项目事项，请在会话中补充开发目标。", 409);
      this.assertExecutor(task, actor);
      const existing = task.snapshot.additions.find(batch => batch.requestId === request.requestId);
      let issues = existing?.issues || await this.store.issues(projectId, request.issueIds);
      if (!existing) {
        this.assertIssues(issues, task.releaseId);
        if (issues.some(issue => !issueWorkflowNode(issue).allowAssignment)) throw accountError("当前事项不允许加入开发，请先完成前置流程。", 409);
        issues = await this.store.assignIssues(projectId, issues, task.executorId, actor.id);
        for (const issue of issues) if (issueWorkflowNode(issue).handler !== "developer" || issue.workflowVersion.definition.transitions.some(edge => edge.from === issue.status && edge.trigger === "development.assigned")) await this.workflow.event(issue, actor, "development.assigned", { executorId: task.executorId });
        issues = await this.store.issues(projectId, request.issueIds);
      }
      const prompt = existing ? existing.prompt : developmentPrompt(issues, true, await this.projects.effectivePrompts(projectId, actor), {}, this.store.attachmentPaths(task, issues));
      const result = await this.store.addIssues(task, request, issues, prompt);
      await this.authorize(projectId, actor, "session.continue");
      return result;
    });
    if (result.batch.status === "ready") {
      await this.store.materializeAttachments(result.task, result.batch.issues);
      await this.authorize(projectId, actor, "session.continue");
    }
    if (request.send && result.batch.status === "ready") return this.continueAddition(projectId, id, actor, request.requestId);
    return { task: await this.present(result.task, actor, true), reused: result.reused };
  }
  async continueAddition(projectId, id, actor, requestId) {
    await this.authorize(projectId, actor, "session.continue");
    const task = await this.store.task(projectId, id);
    this.assertExecutor(task, actor);
    const batch = task.snapshot.additions.find(entry => entry.requestId === requestId);
    if (!batch) throw accountError("追加资料不存在。", 404);
    if (batch.status !== "ready") throw accountError("此批资料已发送或结果不确定，不能重复执行。", 409);
    const context = await this.workspaces.get(task.workspaceId, actor);
    let dispatched = false;
    try {
      await this.store.materializeAttachments(task, batch.issues);
      await this.authorize(projectId, actor, "session.continue");
      const imageIds = batch.messageImageIds || [];
      if (!batch.messageImageIds) {
        for (const bytes of await this.images(projectId, batch.issues)) {
          await this.authorize(projectId, actor, "session.continue");
          imageIds.push((await context.sessions.uploadMessageImage(task.runKey, bytes)).id);
        }
        if (imageIds.length) await this.store.transaction(async () => {
          await this.authorize(projectId, actor, "session.continue");
          return this.store.updateBatch(await this.store.task(projectId, id), requestId, { messageImageIds: imageIds }, "ready");
        });
      }
      const input = [{ type: "text", text: batch.prompt }];
      for (const imageId of imageIds) input.push({ type: "image", path: await context.sessions.messageImagePath(task.runKey, imageId) });
      const sent = await context.sessions.exclusive(task.runKey, async () => context.sessions.sendInput(task.runKey, input, async () => {
        await this.workflowExecution.store.transaction(async () => {
          await this.authorize(projectId, actor, "session.continue");
          await this.store.space(projectId, actor.id);
          const current = await this.store.task(projectId, id);
          this.assertExecutor(current, actor);
          const issues = await this.store.issues(projectId, batch.issueIds);
          this.assertIssues(issues, current.releaseId, true);
          const pending = await this.store.updateBatch(current, requestId, { status: "sending" }, "ready");
          await this.workflowExecution.prepare(pending, actor, { continuation: true });
        });
        dispatched = true;
      }));
      const updated = await this.workflowExecution.store.transaction(async () => this.store.updateBatch(await this.store.task(projectId, id), requestId,
        { status: "sent", sentAt: new Date().toISOString(), turnId: sent.dispatchedTurnId || sent.turnId || null }, "sending"));
      return { task: await this.present(updated, actor, true) };
    } catch (error) {
      if (dispatched) await this.workflowExecution.store.transaction(async () => this.store.updateBatch(await this.store.task(projectId, id), requestId,
        { status: "unknown", error: presentError(error).message }, "sending"));
      throw presentError(error);
    }
  }
}

module.exports = { ProjectDevelopmentServices };
