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
    if (this.store.database) return this.store.savedHistory(key, cursor);
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

  async synchronizeHistory(key) {
    if (!this.store.database) return;
    const state = this.store.read(key);
    if (!state.session_id) return;
    let cursor;
    const startedAt = new Date().toISOString();
    const seen = new Set();
    const pages = [];
    do {
      const result = await this.client.request("thread/items/list", {
        threadId: state.session_id, limit: 50, sortDirection: "desc", ...(cursor ? { cursor } : {}),
      });
      pages.push(result.data || []);
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("会话历史分页重复，补齐已停止。");
      if (cursor) seen.add(cursor);
    } while (cursor);
    const items = [];
    for (const page of pages.reverse()) for (const entry of [...page].reverse()) {
      this.store.recordNotification(key, { method: "history/item", params: entry });
      items.push(this.presenter.item(key, entry.item, entry.turnId));
    }
    this.store.reconcileHistory(key, items, startedAt);
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
        ? this.store.historyItemIdsBefore(key, [...runtime.items.keys()], history.items[0]?.id)
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
    const deletion = this.store.readWorktreeDeletion(key);
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
          [...initializationItems.values(), ...items.values()].map((item) => [
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
          if (this.store.isArchived(key)) return [];
          return [[key, this.presenter.summary(key, state)]];
        } catch {
          return [];
        }
      }),
    );
    for (const runtime of this.sessions.values()) {
      if (this.store.isArchived(runtime.key)) continue;
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
