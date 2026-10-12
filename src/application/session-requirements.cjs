const { taskPrompt } = require("../domain/agent-config.cjs");
const { REQUEST_ID } = require("../domain/requirement-fusion.cjs");
const { presentError } = require("./error-presenter.cjs");

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
