const { taskPrompt } = require("../domain/agent-config.cjs");
const { REQUEST_ID, MAX_REQUIREMENTS } = require("../domain/requirement-fusion.cjs");
const { presentError } = require("./error-presenter.cjs");
const { runKey } = require("../domain/run-identity.cjs");

class SessionRequirements {
  /** @param {import('./session-manager.cjs').SessionManager} manager */
  constructor(manager) {
    this.manager = manager;
    this.store = manager.store;
  }

  async idle(key) {
    const manager = this.manager;
    (await manager.assertWorktreeRetained(key));
    const state = (await this.store.read(key));
    if ((await this.store.isArchived(key))) throw new Error("请先恢复归档任务，再追加或处理需求。");
    if (!state.session_id) throw new Error("任务尚未创建会话，不能追加需求。");
    const reason = manager.worktreeReason(state);
    if (reason) throw new Error(reason);
    try { await manager.git.assertIdle(key, state); }
    catch (error) { throw new Error(presentError(error).message.replace("删除 Worktree", "追加或处理需求")); }
    return state;
  }

  async publish(key) {
    const requirement = (await this.manager.views.presenter.requirement(key));
    this.manager.emit("event", { key, type: "requirements", requirement,
      requirementCount: (await this.store.requirements.read(key)).sources?.length || 1,
      at: new Date().toISOString() });
    return { requirement };
  }

  async append(key, input) {
    return (await this.manager.exclusive(key, async () => {
      const state = (await this.store.read(key));
      const channel = this.manager.channels.get(state.source?.channel || "tapd");
      if (!channel.capabilities?.fusion) throw new Error("该任务不支持追加 TAPD 需求。");
      const resolved = await channel.resolve({ ...input, title: "追加需求" });
      if (!resolved.item.requirements) throw new Error("请选择要追加的需求。");
      if (String(resolved.item.workspace_id) !== String(state.workitem.workspace_id))
        throw new Error("追加需求必须与原任务属于同一个 TAPD 项目。");
      const saved = (await this.store.requirements.read(key));
      const previous = saved.additions?.find(entry => entry.id === input.requestId);
      if (previous) {
        if (previous.fingerprint !== resolved.item.request_fingerprint)
          throw new Error("同一操作标识不能提交不同需求，请重新打开表单。");
        return (await this.publish(key));
      }
      if ((saved.sources?.length || state.workitem.sources?.length || 1) + resolved.item.sources.length > MAX_REQUIREMENTS)
        throw new Error("一个任务最多关联 20 条需求。");
      const assignments = (await this.store.requirements.assignments());
      for (const source of resolved.item.sources)
        if (assignments.has(runKey(source)))
          throw new Error(`需求 ${source.id} 已归属任务 ${assignments.get(runKey(source))}，请打开原任务。`);
      await this.idle(key);
      const { task } = await channel.prepare({ ...resolved,
        directory: this.store.additionDirectory(key, input.requestId) });
      this.manager.assertOpen();
      await this.idle(key);
      (await this.store.requirements.claim(key, resolved.item.sources, {
        addition: { id: input.requestId, fingerprint: resolved.item.request_fingerprint,
          status: "ready", createdAt: new Date().toISOString(), task },
      }));
      return (await this.publish(key));
    }));
  }

  async continue(key, id) {
    return (await this.manager.exclusive(key, async () => {
      if (!REQUEST_ID.test(id || "")) throw new Error("追加资料标识无效。");
      const addition = (await this.store.requirements.read(key)).additions?.find(entry => entry.id === id);
      if (!addition) throw new Error("追加资料不存在。");
      if (addition.status === "sent") return { sent: true, turnId: addition.turnId };
      if (addition.status !== "ready")
        throw new Error("上次发送结果尚不确定，请检查会话历史后通过消息继续，系统不会自动重发。");
      await this.idle(key);
      const task = addition.task;
      const input = [{ type: "text", text:
        `请在当前会话和现有代码基础上处理以下新增需求，保留已有实现，并检查与原需求的冲突。\n\n${taskPrompt(task)}` }, ...(await this.store.additionMessageImages(key, id)).map(image => ({ type: "image",
        path: image.path }))];
      let dispatched = false;
      try {
        const result = await this.manager.sendInput(key, input, async () => {
          (await this.store.requirements.updateAddition(key, id, entry => {
            if (entry.status !== "ready") throw new Error("这批需求已经发送或正在发送。");
            return { status: "sending" };
          }));
          dispatched = true;
          (await this.publish(key));
        });
        (await this.store.requirements.updateAddition(key, id, () => ({ status: "sent", turnId: result.dispatchedTurnId,
          sentAt: new Date().toISOString() })));
        (await this.publish(key));
        return result;
      } catch (error) {
        if (dispatched) {
          (await this.store.requirements.updateAddition(key, id, () => ({ status: "uncertain" })));
          (await this.publish(key));
        }
        throw error;
      }
    }));
  }
}

module.exports = { SessionRequirements };
