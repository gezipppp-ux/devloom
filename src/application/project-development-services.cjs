const { isDeepStrictEqual } = require("node:util");
const { ProjectDevelopmentStore } = require("../storage/project-development-store.cjs");
const { AccountStore } = require("../storage/account-store.cjs");
const { developmentInput, developmentStartInput, developmentEditInput, developmentPrompt } = require("../domain/project-development.cjs");
const { issueDevelopmentAllowed, assertIssueWritable } = require("../domain/issue-workflows.cjs");
const { pageInput, identifier, object, revision } = require("../domain/project-issues.cjs");
const { accountError } = require("../domain/account.cjs");
const { presentError } = require("./error-presenter.cjs");
const { presentDevelopment } = require("./project-development-presenter.cjs");

class ProjectDevelopmentServices {
  constructor(database, projects, workspaces) {
    this.store = new ProjectDevelopmentStore(database);
    this.accounts = new AccountStore(database);
    this.projects = projects;
    this.workspaces = workspaces;
    this.starting = new Set();
  }
  async authorize(projectId, actor, permission) {
    await this.projects.authorize(projectId, actor, "issue.view");
    return this.projects.authorize(projectId, actor, permission);
  }
  async present(task, actor, detail = false) {
    const execution = await this.store.execution(task);
    const { permissions, project } = await this.authorize(task.projectId, actor, "issue.view");
    return presentDevelopment(task, actor.id, execution, { detail, permissions, projectStatus: project.status });
  }
  async list(projectId, actor, input = {}) {
    await this.authorize(projectId, actor, "issue.view");
    const page = await this.store.list(projectId, { ...pageInput(input), ...(input.issueId ? { issueId: identifier(input.issueId, "事项") } : {}) });
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
  async images(projectId, issues) {
    const images = issues.flatMap(issue => (issue.files || []).filter(file => ["image/png", "image/jpeg", "image/webp"].includes(file.mimeType)).map(file => ({ ...file, issueId: issue.id })));
    if (images.length > 20) throw accountError("所选事项图片合计超过 20 张，请拆分开发任务。", 400);
    const values = [];
    for (const file of images) values.push(await this.store.issueImage(projectId, file.issueId, file.id));
    return values;
  }
  async authorizePlan(projectId, actor, executorId) {
    await this.authorize(projectId, actor, executorId === actor.id ? "session.start" : "issue.assign");
    const context = await this.projects.authorize(projectId, { id: executorId }, "session.start");
    if (context.membership?.status !== "active") throw accountError("执行人必须是具备开发资格的有效项目成员。", 403);
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
      const existing = await this.store.existing(projectId, actor.id, request.requestId);
      if (existing) { this.store.sameRequest(existing, request); return { task: existing, reused: true }; }
      const issues = await this.store.issues(projectId, request.issueIds);
      this.assertIssues(issues, issues[0].releaseId);
      return { task: await this.store.create(projectId, actor.id, request, issues), reused: false };
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
      if (request.executorId && request.executorId !== current.executorId) {
        await this.authorize(projectId, actor, "issue.assign");
        await this.authorizePlan(projectId, actor, request.executorId);
      }
      const issues = await this.store.issues(projectId, request.issueIds || current.snapshot.issues.map(issue => issue.id));
      this.assertIssues(issues, current.releaseId);
      return this.store.replacePlan(current, request, issues);
    });
    return { task: await this.present(task, actor, true) };
  }
  async start(projectId, id, actor, input) {
    const request = developmentStartInput(input);
    const accepted = await this.store.transaction(async () => {
      await this.authorize(projectId, actor, "session.start");
      const current = await this.store.task(projectId, id);
      if (current.executorId !== actor.id) throw accountError("只有任务执行人能开始开发。", 403);
      if (current.snapshot.startRequest) {
        if (!isDeepStrictEqual(current.snapshot.startRequest, request)) throw accountError("任务已接受启动请求，不能修改参数或再次启动。", 409);
        return { task: current, created: false };
      }
      this.assertRevision(current, request.revision);
      if (current.status !== "planned") throw accountError("仅待开发任务可以启动。", 409);
      const space = await this.store.space(projectId, actor.id);
      const issues = await this.store.issues(projectId, current.snapshot.issues.map(issue => issue.id));
      this.assertIssues(issues, current.releaseId, true);
      const prompt = developmentPrompt(issues);
      const defaults = await this.accounts.settings(actor.id);
      const selection = Object.fromEntries(["model", "reasoningEffort", "permissionMode"].map(field => [field,
        Object.hasOwn(request, field) ? request[field] : defaults[field] ?? ""]));
      const task = await this.store.acceptStart(current, space, request, issues, prompt, selection);
      await this.authorize(projectId, actor, "session.start");
      return { task, created: true };
    });
    if (!accepted.created) return { task: await this.present(accepted.task, actor, true), reused: true };
    let task = accepted.task;
    this.starting.add(task.id);
    try {
      const context = await this.workspaces.get(task.workspaceId, actor);
      const imageIds = [];
      for (const bytes of await this.images(projectId, task.snapshot.issues)) {
        await this.authorize(projectId, actor, "session.start");
        imageIds.push((await context.channels.get("manual").uploadImage(bytes)).id);
      }
      await this.authorize(projectId, actor, "session.start");
      await this.store.space(projectId, actor.id);
      const started = await context.sessions.start({ channel: "manual", requestId: task.id,
        baseBranch: task.snapshot.baseBranch, title: task.snapshot.title, content: task.snapshot.prompt, images: imageIds, ...task.snapshot.selection });
      if (started.key !== task.runKey) throw new Error("开发任务与会话身份不一致，请检查已记录任务。");
      task = await this.store.transaction(async () => this.store.update(await this.store.task(projectId, task.id), { status: "started" }));
    } catch (error) {
      const safe = presentError(error);
      await this.store.transaction(async () => this.store.update(await this.store.task(projectId, task.id), { status: "unknown", error: safe.message }));
      throw safe;
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
      if (["completed", "cancelled"].includes(task.status)) throw accountError("开发任务已结束。", 409);
      if (status === "completed" && task.status === "planned") throw accountError("待开发任务只能取消；开始开发后才能完成。", 409);
      if (this.starting.has(task.id)) throw accountError("开发任务正在准备，请等待执行结束。", 409);
      const issues = await this.store.issues(projectId, [...task.snapshot.issues.map(issue => issue.id), ...task.snapshot.additions.flatMap(batch => batch.issueIds)]);
      this.assertIssues(issues, task.releaseId);
      if (task.runKey) {
        const execution = await this.store.execution(task);
        if (!execution || !["completed", "failed", "interrupted", "cancelled"].includes(execution.status))
          throw accountError("执行仍在进行或状态不明，请先确认原会话已结束。", 409);
      }
      return this.store.finish(task, status, actor.id);
    });
    let task;
    if (initial.runKey) {
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
      this.assertExecutor(task, actor);
      const existing = task.snapshot.additions.find(batch => batch.requestId === request.requestId);
      const issues = existing?.issues || await this.store.issues(projectId, request.issueIds);
      if (!existing) {
        this.assertIssues(issues, task.releaseId, true);
      }
      const result = await this.store.addIssues(task, request, issues, existing?.prompt || developmentPrompt(issues, true));
      await this.authorize(projectId, actor, "session.continue");
      return result;
    });
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
        await this.store.transaction(async () => {
          await this.authorize(projectId, actor, "session.continue");
          await this.store.space(projectId, actor.id);
          const current = await this.store.task(projectId, id);
          this.assertExecutor(current, actor);
          const issues = await this.store.issues(projectId, batch.issueIds);
          this.assertIssues(issues, current.releaseId, true);
          await this.store.updateBatch(current, requestId, { status: "sending" }, "ready");
        });
        dispatched = true;
      }));
      const updated = await this.store.transaction(async () => this.store.updateBatch(await this.store.task(projectId, id), requestId,
        { status: "sent", sentAt: new Date().toISOString(), turnId: sent.dispatchedTurnId || sent.turnId || null }, "sending"));
      return { task: await this.present(updated, actor, true) };
    } catch (error) {
      if (dispatched) await this.store.transaction(async () => this.store.updateBatch(await this.store.task(projectId, id), requestId,
        { status: "unknown", error: presentError(error).message }, "sending"));
      throw presentError(error);
    }
  }
}

module.exports = { ProjectDevelopmentServices };
