const { ProjectDevelopmentStore } = require("../storage/project-development-store.cjs");
const { AccountStore } = require("../storage/account-store.cjs");
const { developmentInput, developmentPrompt } = require("../domain/project-development.cjs");
const { pageInput, identifier } = require("../domain/project-issues.cjs");
const { accountError } = require("../domain/account.cjs");
const { presentError } = require("./error-presenter.cjs");
const { presentDevelopment } = require("./project-development-presenter.cjs");

class ProjectDevelopmentServices {
  constructor(database, projects, workspaces) {
    this.store = new ProjectDevelopmentStore(database);
    this.accounts = new AccountStore(database);
    this.projects = projects;
    this.workspaces = workspaces;
  }
  async authorize(projectId, actor, permission) {
    await this.projects.authorize(projectId, actor, "issue.view");
    return this.projects.authorize(projectId, actor, permission);
  }
  async present(task, actor, detail = false) {
    const execution = actor.id === task.executorId ? await this.store.execution(task) : null;
    return presentDevelopment(task, actor.id, execution, { detail });
  }
  async list(projectId, actor, input = {}) {
    await this.authorize(projectId, actor, "session.view");
    const page = await this.store.list(projectId, { ...pageInput(input), ...(input.issueId ? { issueId: identifier(input.issueId, "事项") } : {}) });
    const tasks = await Promise.all(page.tasks.map(task => this.present(task, actor)));
    await this.authorize(projectId, actor, "session.view");
    return { tasks, nextOffset: page.nextOffset };
  }
  async read(projectId, id, actor) {
    await this.authorize(projectId, actor, "session.view");
    const task = await this.present(await this.store.task(projectId, id), actor, true);
    await this.authorize(projectId, actor, "session.view");
    return { task };
  }
  async images(projectId, issues) {
    const images = issues.flatMap(issue => (issue.files || []).filter(file => ["image/png", "image/jpeg", "image/webp"].includes(file.mimeType)).map(file => ({ ...file, issueId: issue.id })));
    if (images.length > 20) throw accountError("所选事项图片合计超过 20 张，请拆分开发任务。", 400);
    const values = [];
    for (const file of images) values.push(await this.store.issueImage(projectId, file.issueId, file.id));
    return values;
  }
  async start(projectId, actor, input) {
    const request = developmentInput(input);
    await this.authorize(projectId, actor, "session.start");
    const accepted = await this.store.transaction(async () => {
      await this.authorize(projectId, actor, "session.start");
      const existing = await this.store.existing(projectId, actor.id, request.requestId);
      if (existing) { this.store.sameRequest(existing, request); return { task: existing, created: false }; }
      const space = await this.store.space(projectId, actor.id);
      const issues = await this.store.issues(projectId, request.issueIds);
      const prompt = developmentPrompt(issues);
      const defaults = await this.accounts.settings(actor.id);
      const selection = Object.fromEntries(["model", "reasoningEffort", "permissionMode"].map(field => [field,
        Object.hasOwn(request, field) ? request[field] : defaults[field] ?? ""]));
      const task = await this.store.create(projectId, actor.id, space, request, issues, prompt, selection);
      await this.authorize(projectId, actor, "session.start");
      return { task, created: true };
    });
    if (!accepted.created) return { task: await this.present(accepted.task, actor, true), reused: true };
    let task = accepted.task;
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
        title: task.snapshot.title, content: task.snapshot.prompt, images: imageIds, ...task.snapshot.selection });
      if (started.key !== task.runKey) throw new Error("开发任务与会话身份不一致，请检查已记录任务。");
      task = await this.store.transaction(async () => this.store.update(await this.store.task(projectId, task.id), { status: "started" }));
    } catch (error) {
      const safe = presentError(error);
      await this.store.transaction(async () => this.store.update(await this.store.task(projectId, task.id), { status: "unknown", error: safe.message }));
      throw safe;
    }
    await this.authorize(projectId, actor, "session.start");
    return { task: await this.present(task, actor, true) };
  }
  assertExecutor(task, actor) {
    if (task.executorId !== actor.id) throw accountError("只能在自己的开发空间中继续会话。", 403);
    if (task.status !== "started" || !task.runKey) throw accountError("开发任务尚未开始或结果不确定，请检查原会话。", 409);
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
          await this.store.updateBatch(await this.store.task(projectId, id), requestId, { status: "sending" }, "ready");
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
