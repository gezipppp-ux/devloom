const { assertAgentIdentity, assertCapability } = require("../domain/agent-contract.cjs");
const { initializationItem } = require("../domain/session-item.cjs");
const { presentError } = require("./error-presenter.cjs");

const { SessionPresenter } = require("./session-presenter.cjs");

// Read-only queries combine saved records, canonical history and the current live projection.
class SessionViews {
  constructor({
    store,
    agent,
    sessions,
    settings,
    worktreeReason,
    apiPrefix,
    assertOpen,
  }) {
    /** @type {import('../storage/run-store.cjs').RunStore} */
    this.store = store;
    this.agent = agent;
    this.sessions = sessions;
    this.worktreeReason = worktreeReason;
    this.assertOpen = assertOpen;
    this.presenter = new SessionPresenter({ store, settings, apiPrefix, agent });
  }

  async history(key, cursor) {
    return this.agent.withSession ? this.agent.withSession(key, () => this.readHistory(key, cursor)) : this.readHistory(key, cursor);
  }

  async readHistory(key, cursor) {
    this.assertOpen();
    const state = (await this.store.read(key));
    if (!state.session_id) return { items: [], nextCursor: null };
    if (this.store.database) return (await this.store.savedHistory(key, cursor));
    assertAgentIdentity(this.agent, state);
    assertCapability(this.agent, "history");
    await this.agent.connect();
    this.assertOpen();
    const result = await this.agent.listHistory({
      sessionId: state.session_id,
      limit: 50,
      ...(cursor ? { cursor } : {}),
    });
    return {
      items: await Promise.all(result.items.map(item => this.presenter.item(key, item, item.turnId, { capturePreviews: false }))),
      nextCursor: result.nextCursor,
    };
  }

  async synchronizeHistory(key) {
    return this.agent.withSession ? this.agent.withSession(key, () => this.syncHistory(key)) : this.syncHistory(key);
  }

  async syncHistory(key) {
    if (!this.store.database) return;
    const state = (await this.store.read(key));
    if (!state.session_id) return;
    assertAgentIdentity(this.agent, state);
    assertCapability(this.agent, "history");
    let cursor;
    const startedAt = new Date().toISOString();
    const seen = new Set();
    const pages = [];
    do {
      const result = await this.agent.listHistory({
        sessionId: state.session_id, limit: 50, ...(cursor ? { cursor } : {}),
      });
      pages.push(result.items || []);
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("会话历史分页重复，补齐已停止。");
      if (cursor) seen.add(cursor);
    } while (cursor);
    const items = [];
    for (const page of pages.reverse()) for (const item of page) {
      (await this.store.recordNotification(key, { type: "history-item", item }));
      items.push((await this.presenter.item(key, item, item.turnId, { capturePreviews: false })));
    }
    (await this.store.reconcileHistory(key, items, startedAt));
  }

  async view(key) {
    const runtime = this.sessions.get(key);
    let state;
    try {
      state = (await this.store.read(key));
    } catch (error) {
      if (error.code !== "ENOENT" || !runtime) throw error;
      return {
        key,
        title: "正在准备需求",
        status: runtime.status,
        items: [],
        requests: [],
        images: [],
        error: runtime.error,
        readOnlyReason: "正在准备工作区，请稍候",
      };
    }
    let history;
    let warning;
    try {
      history = await this.history(key);
    } catch (error) {
      history = { items: this.store.database ? (await this.store.savedHistory(key)).items : [], nextCursor: null };
      warning = presentError(error).message;
    }
    const items = new Map(history.items.map((item) => [item.id, item]));
    const initializationItems = new Map(
      (state.initialization?.commands || []).map(initializationItem)
        .map((item) => [item.id, item]),
    );
    for (const [id, item] of items) if (item.type === "worktreeInitialization") {
      initializationItems.set(id, item);
      items.delete(id);
    }
    if (runtime) {
      const earlierIds = this.store.database
        ? (await this.store.historyItemIdsBefore(key, [...runtime.items.keys()], history.items[0]?.id))
        : new Set();
      // File adapters have no saved ordering index. An overlapping live item
      // anchors the page; keep unanchored items when their age is unknown.
      let beforePage = !this.store.database && Boolean(history.nextCursor) &&
        history.items.some((item) => runtime.items.has(item.id));
      for (const [id, item] of runtime.items) {
        if (items.has(id)) beforePage = false;
        if (item.type === "worktreeInitialization") initializationItems.set(id, item);
        // Old runtime entries belong to earlier pages. New entries remain
        // visible even if they were saved after this page was read.
        else if (items.has(id) || (!beforePage && !earlierIds.has(id))) items.set(id, item);
      }
    }
    const deletion = (await this.store.readWorktreeDeletion(key));
    let readOnlyReason = deletion.worktreeRemoved || deletion.status === "deleted"
      ? "Worktree 已删除，此会话仅供查看。"
      : deletion.status === "deleting"
        ? "Worktree 删除操作尚未完成，请在 Git 面板中检查。"
      : this.worktreeReason(state);
    if (
      !readOnlyReason &&
      this.store.isExecutionLocked(key) &&
      !runtime?.initial &&
      !["preparing", "initializing"].includes(runtime?.status)
    )
      readOnlyReason = runtime?.pipelineActive
        ? "正在完成首轮记录，请稍候再发送。"
        : "任务仍由另一个 CLI 运行器持有；结束后才能在网页继续。";
    if (
      runtime &&
      ["preparing", "initializing", "starting"].includes(runtime.status)
    )
      readOnlyReason ||= "正在准备会话，请稍候";
    if (!state.session_id)
      readOnlyReason ||= "尚未创建执行器会话，请查看准备或初始化记录。";
    return {
      ...(await this.presenter.summary(key, state)),
      status:
        runtime?.status ||
        (["running", "initializing"].includes(state.execution.status)
          ? "disconnected"
          : state.execution.status),
      turnId: runtime?.turnId,
      connected: runtime?.connected || false,
      error: runtime?.error || state.execution.error,
      lastActivity: runtime?.lastActivity || state.updated_at,
      readOnlyReason,
      warning,
      items: [
        ...new Map(
          [...initializationItems.values(), ...items.values()].map((item) => [
            item.id,
            item,
          ]),
        ).values(),
      ],
      nextCursor: history.nextCursor,
      requests: [...(runtime?.requests.values() || [])],
      images: (await this.presenter.images(key)),
      requirement: (await this.presenter.requirement(key, state)),
    };
  }

  // Attention queries inspect live requests without connecting or resuming an Agent.
  async pendingRequests() {
    this.assertOpen();
    const result = [];
    for (const runtime of this.sessions.values()) {
      if (!runtime.connected || runtime.deleting || !runtime.requests.size) continue;
      if (await this.store.isArchived(runtime.key)) continue;
      const state = await this.store.read(runtime.key);
      const title = await this.store.readSessionTitle(runtime.key, state.workitem?.title || state.workitem?.name || runtime.key);
      if (this.sessions.get(runtime.key) !== runtime || !runtime.connected || runtime.deleting) continue;
      const requests = [...runtime.requests.values()].filter(request =>
        (!request.turnId || request.turnId === runtime.turnId) &&
        this.agent.capabilities?.[request.kind === "user-input" ? "userInput" : "approvals"] === true &&
        ["approval", "user-input"].includes(request.kind),
      ).map(request => ({ id: String(request.id), kind: request.kind, blocking: request.blocking !== false, turnId: request.turnId || runtime.turnId || "" }));
      if (requests.length) result.push({ key: runtime.key, title, updatedAt: runtime.lastActivity || state.updated_at, requests });
    }
    return result;
  }

  async list({ archived = false } = {}) {
    const saved = new Map(
      (await Promise.all((await this.store.list()).flatMap(async ({ key, state }) => {
        try {
          if ((await this.store.isArchived(key)) !== archived) return [];
          return [[key, (await this.presenter.summary(key, state))]];
        } catch {
          return [];
        }
      }))).flat(),
    );
    for (const runtime of this.sessions.values()) {
      if ((await this.store.isArchived(runtime.key)) !== archived) continue;
      saved.set(runtime.key, {
        ...(saved.get(runtime.key) || {
          key: runtime.key,
          title: "正在准备需求",
          sources: (await this.store.requirements.read(runtime.key)).sources || [],
          requirementCount: (await this.store.requirements.read(runtime.key)).sources?.length || 1,
        }),
        status: runtime.status,
        sessionId: runtime.sessionId,
        updatedAt: runtime.lastActivity,
      });
    }
    return [...saved.values()].sort((a, b) =>
      String(archived ? b.archivedAt : b.updatedAt).localeCompare(String(archived ? a.archivedAt : a.updatedAt)),
    );
  }
}

module.exports = { SessionViews };
