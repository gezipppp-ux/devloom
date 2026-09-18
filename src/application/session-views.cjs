const { initializationItem } = require("../domain/session-item.cjs");

const { SessionPresenter } = require("./session-presenter.cjs");

// Read-only queries combine saved records, canonical history and the current live projection.
class SessionViews {
  constructor({
    store,
    client,
    sessions,
    settings,
    worktreeReason,
    apiPrefix,
    assertOpen,
  }) {
    this.store = store;
    this.client = client;
    this.sessions = sessions;
    this.worktreeReason = worktreeReason;
    this.assertOpen = assertOpen;
    this.presenter = new SessionPresenter({ store, settings, apiPrefix });
  }

  async history(key, cursor) {
    this.assertOpen();
    const state = this.store.read(key);
    if (!state.session_id) return { items: [], nextCursor: null };
    await this.client.connect();
    this.assertOpen();
    const result = await this.client.request("thread/items/list", {
      threadId: state.session_id,
      limit: 50,
      sortDirection: "desc",
      ...(cursor ? { cursor } : {}),
    });
    return {
      items: result.data
        .map((entry) => this.presenter.item(key, entry.item, entry.turnId))
        .reverse(),
      nextCursor: result.nextCursor,
    };
  }

  async view(key) {
    const runtime = this.sessions.get(key);
    let state;
    try {
      state = this.store.read(key);
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
      history = { items: this.store.legacyHistory(key), nextCursor: null };
      warning = error.message;
    }
    const items = new Map(history.items.map((item) => [item.id, item]));
    const initializationItems = (state.initialization?.commands || []).map(
      initializationItem,
    );
    if (runtime) for (const [id, item] of runtime.items) items.set(id, item);
    let readOnlyReason = this.worktreeReason(state);
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
      readOnlyReason ||= "尚未创建 Codex session，请查看准备或初始化记录。";
    return {
      ...this.presenter.summary(key, state),
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
          [...initializationItems, ...items.values()].map((item) => [
            item.id,
            item,
          ]),
        ).values(),
      ],
      nextCursor: history.nextCursor,
      requests: [...(runtime?.requests.values() || [])],
      images: this.presenter.images(key),
      requirement: this.presenter.requirement(key, state),
    };
  }

  list() {
    const saved = new Map(
      this.store.list().flatMap(({ key, state }) => {
        try {
          return [[key, this.presenter.summary(key, state)]];
        } catch {
          return [];
        }
      }),
    );
    for (const runtime of this.sessions.values()) {
      saved.set(runtime.key, {
        ...(saved.get(runtime.key) || {
          key: runtime.key,
          title: "正在准备需求",
          metadata: this.store.readTaskMetadata(runtime.key),
        }),
        status: runtime.status,
        sessionId: runtime.sessionId,
        updatedAt: runtime.lastActivity,
      });
    }
    return [...saved.values()].sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
  }
}

module.exports = { SessionViews };
