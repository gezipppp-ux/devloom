const { OUTPUT_LIMIT } = require("../domain/session-item.cjs");
const { presentError } = require("./error-presenter.cjs");
const { SessionPresenter } = require("./session-presenter.cjs");
const { assertCapability } = require("../domain/agent-contract.cjs");

// Projects normalized agent events and interactive requests into one workspace's runtime.
class SessionEvents {
  constructor({ store, agent, sessions, settings, emit, apiPrefix, synchronizeHistory }) {
    /** @type {import('../storage/run-store.cjs').RunStore} */
    this.store = store;
    this.agent = agent;
    this.sessions = sessions;
    /** @type {import('./session-settings.cjs').SessionSettings} */
    this.settings = settings;
    this.synchronizeHistory = synchronizeHistory;
    this.emit = emit;
    this.presenter = new SessionPresenter({ store, settings, apiPrefix, agent });
    this.pendingCallbacks = new Set();
    this.pendingHistory = new Map();
    this.historyTimers = new Map();
    this.completions = new Map();
    this.incoming = new Map();
    this.queuedRequests = new Map();
    agent.on("event", event => {
      const runtime = this.runtimeFor(event);
      return this.enqueue(runtime?.key, () => this.notification(event, runtime));
    });
    agent.on("request", request => {
      const runtime = this.runtimeFor(request);
      if (runtime) this.queuedRequests.set(request, runtime);
      return this.enqueue(runtime?.key, async () => {
        try { await this.serverRequest(request, runtime); }
        finally { this.queuedRequests.delete(request); }
      });
    });
    agent.on("disconnected", (error, key) => this.disconnected(error, key));
  }

  runtimeFor({ sessionId, type, requestId }) {
    if (type === "request-resolved" && !sessionId) {
      const queued = [...this.queuedRequests].find(([request]) => request.id === requestId);
      if (queued) return queued[1];
    }
    return [...this.sessions.values()].find(entry =>
      (typeof sessionId === "string" && entry.sessionId === sessionId) ||
      (type === "request-resolved" && !sessionId && entry.requests.has(requestId)),
    );
  }

  enqueue(key, operation) {
    const runtime = this.sessions.get(key);
    const pending = (this.incoming.get(key) || Promise.resolve()).then(() =>
      this.agent.withSession ? this.agent.withSession(key, operation) : operation(),
    ).catch(error => {
      if (runtime && this.sessions.get(key) === runtime && !runtime.deleting) this.fail(runtime, error);
    }).finally(() => {
      if (this.incoming.get(key) === pending) this.incoming.delete(key);
    });
    this.incoming.set(key, pending);
    return pending;
  }

  // Commands fence only their own session; shutdown still drains every queue.
  async drain(key) {
    while (true) {
      const pending = key === undefined ? [...this.incoming.values()] : [this.incoming.get(key)].filter(Boolean);
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  fail(runtime, error) {
    error = presentError(error);
    runtime.error = error.message;
    runtime.initial?.reject(error);
    this.emit({ key: runtime.key, type: "error", error: error.message });
    if (runtime.turnId) void this.agent.interruptTurn({ sessionId: runtime.sessionId, turnId: runtime.turnId }).catch(() => {});
  }

  disconnected(error, key) {
    error = presentError(error);
    // Snapshot the affected runtimes before a new connection creates sessions.
    // Each session orders this after its received events, without waiting for
    // another session's history or persistence to finish.
    return Promise.all([...this.sessions.values()].filter(runtime => key === undefined || runtime.key === key).map(runtime =>
      this.enqueue(runtime.key, () => this.disconnectRuntime(runtime, error)),
    ));
  }

  async disconnectRuntime(runtime, error) {
    if (runtime.deleting || this.sessions.get(runtime.key) !== runtime) return;
    (await this.flushHistory(runtime.key));
    runtime.connected = false;
    runtime.requests.clear();
    if (runtime.turnId) {
      runtime.status = "disconnected";
      runtime.error = error.message;
    }
    clearTimeout(runtime.initial?.timer);
    runtime.initial?.reject(error);
    runtime.initial = null;
    (await this.publish(runtime, { type: "state", requests: [] }));
  }

  async flushHistory(key) {
    clearTimeout(this.historyTimers.get(key));
    this.historyTimers.delete(key);
    const pending = this.pendingHistory.get(key);
    if (!pending) return;
    this.pendingHistory.delete(key);
    for (const item of pending.values()) (await this.store.saveHistoryItem(key, item));
  }

  bufferHistory(runtime, item) {
    let pending = this.pendingHistory.get(runtime.key);
    if (!pending) this.pendingHistory.set(runtime.key, pending = new Map());
    pending.set(item.id, structuredClone(item));
    if (this.historyTimers.has(runtime.key)) return;
    this.historyTimers.set(runtime.key, setTimeout(() => {
      this.enqueue(runtime.key, () => this.flushHistory(runtime.key));
    }, 150));
  }

  async publish(runtime, event, deferHistory = false) {
    runtime.lastActivity = new Date().toISOString();
    const data = {
      key: runtime.key,
      at: runtime.lastActivity,
      status: runtime.status,
      turnId: runtime.turnId,
      sessionId: runtime.sessionId,
      ...(event.type === "state" &&
      this.settings &&
      (await this.store.hasRun(runtime.key))
        ? (await this.settings.describe(runtime.key))
        : {}),
      ...event,
    };
    if (event.type === "item") {
      if (deferHistory && this.store.database) this.bufferHistory(runtime, event.item);
      else {
        (await this.flushHistory(runtime.key));
        (await this.store.saveHistoryItem?.(runtime.key, event.item));
      }
    }
    (await this.store.log(
      runtime.key,
      event.type === "item"
        ? {
            ...data,
            item: {
              id: event.item.id,
              type: event.item.type,
              status: event.item.status,
            },
          }
        : data,
    ));
    this.emit(data);
  }

  async persist(runtime) {
    const previous = (await this.store.readWeb(runtime.key));
    (await this.store.writeWeb(runtime.key, {
      ...previous,
      sessionId: runtime.sessionId,
      turnId: runtime.turnId,
      status: runtime.status,
      lastActivity: runtime.lastActivity,
    }));
  }

  async notification(event, runtime) {
    const { type } = event;
    if (!runtime || runtime.deleting || this.sessions.get(runtime.key) !== runtime) return;
    try {
      (await this.store.recordNotification?.(runtime.key, event));
      if (type === "turn-started") {
        if (runtime.supplier) await this.store.log(runtime.key, {
          type: "turn-configuration", turnId: event.turn.id, supplier: runtime.supplier,
          selection: runtime.activeExecutionSettings, at: new Date().toISOString(),
        });
        runtime.turnId = event.turn.id;
        runtime.status = "running";
        runtime.connected = true;
        runtime.error = null;
        if (runtime.initial && !runtime.initial.started) {
          const initial = runtime.initial;
          initial.started = true;
          clearTimeout(initial.timer);
          initial.callback = Promise.resolve()
            .then(initial.onStarted)
            .catch((error) => {
              initial.callbackError = presentError(error);
            });
          this.pendingCallbacks.add(initial.callback);
          void initial.callback.finally(() => {
            this.pendingCallbacks.delete(initial.callback);
          });
        } else if (!runtime.initial) {
          (await this.store.update(runtime.key, {
            execution: {
              status: "running",
              session_id: runtime.sessionId,
            },
          }));
        }
        (await this.publish(runtime, { type: "state" }));
        (await this.persist(runtime));
      } else if (type === "turn-completed") {
        await this.completed(runtime, event.turn);
      } else if (type === "item") {
        const previous = runtime.items.get(event.item.id);
        const item = (await this.presenter.item(
          runtime.key,
          event.item,
          event.turnId,
        ));
        item.output ||= previous?.output || "";
        item.text ||= previous?.text || "";
        if (!item.images?.length && previous?.images)
          item.images = previous.images;
        runtime.items.set(item.id, item);
        (await this.publish(runtime, { type: "item", item }));
      } else if (
        type === "item-delta"
      ) {
        if (!["text", "output"].includes(event.field)) return;
        const isMessage = event.field === "text";
        const item = runtime.items.get(event.itemId) || {
          id: event.itemId,
          turnId: event.turnId,
          type: isMessage ? "agentMessage" : "commandExecution",
          status: "inProgress",
          text: "",
          output: "",
        };
        const property = isMessage ? "text" : "output";
        item[property] = `${item[property] || ""}${event.delta || ""}`.slice(
          -OUTPUT_LIMIT,
        );
        runtime.items.set(item.id, item);
        (await this.publish(runtime, { type: "item", item }, true));
      } else if (type === "request-resolved") {
        runtime.requests.delete(event.requestId);
        (await this.publish(runtime, {
          type: "requests",
          requests: [...runtime.requests.values()],
        }));
      }
      while (runtime.items.size > 500)
        runtime.items.delete(runtime.items.keys().next().value);
    } catch (error) {
      this.fail(runtime, error);
    }
  }

  completed(runtime, turn) {
    const pending = this.completeTurn(runtime, turn);
    let completions = this.completions.get(runtime.key);
    if (!completions) this.completions.set(runtime.key, completions = new Set());
    completions.add(pending);
    const settled = () => {
      completions.delete(pending);
      if (!completions.size) this.completions.delete(runtime.key);
    };
    void pending.then(settled, settled);
    return pending;
  }

  async settle(key) {
    await this.drain(key);
    while (this.completions.has(key))
      await Promise.allSettled([...this.completions.get(key)]);
    (await this.flushHistory(key));
  }

  async completeTurn(runtime, turn) {
    if (runtime.turnId && runtime.turnId !== turn.id) return;
    const initial = runtime.initial;
    (await this.flushHistory(runtime.key));
    runtime.completedTurns.add(turn.id);
    if (runtime.completedTurns.size > 500)
      runtime.completedTurns.delete(
        runtime.completedTurns.values().next().value,
      );
    if (initial?.callback) await initial.callback;
    if (
      runtime.initial !== initial ||
      (runtime.turnId && runtime.turnId !== turn.id)
    )
      return;
    runtime.turnId = null;
    runtime.status = turn.status;
    runtime.error = turn.error?.message || null;
    runtime.requests.clear();
    for (const item of runtime.items.values()) {
      if (item.turnId === turn.id && item.status === "inProgress")
        item.status = turn.status;
      (await this.store.saveHistoryItem?.(runtime.key, item));
    }
    (await this.store.update(runtime.key, {
      execution: {
        status: turn.status,
        session_id: runtime.sessionId,
        completed: turn.status === "completed",
        error: runtime.error,
      },
    }));
    (await this.publish(runtime, {
      type: "state",
      error: runtime.error,
      requests: [],
    }));
    (await this.persist(runtime));
    if (this.store.database && this.synchronizeHistory) {
      try { await this.synchronizeHistory(runtime.key); }
      catch (error) { (await this.publish(runtime, { type: "error", error: `历史补齐失败：${presentError(error).message}` })); }
    }
    const lastMessage = [...runtime.items.values()]
      .filter((item) => item.turnId === turn.id && item.type === "agentMessage")
      .at(-1);
    if (lastMessage) (await this.store.writeFinal(runtime.key, lastMessage.text));
    await this.agent.recordTurnEvent?.(runtime.key, { type: "turn-completed", turn });
    if (initial) clearTimeout(initial.timer);
    runtime.initial = null;
    if (initial) {
      if (initial.callbackError) initial.reject(initial.callbackError);
      else
        initial.resolve({
          session_id: runtime.sessionId,
          completed: turn.status === "completed",
          status: turn.status,
          error: runtime.error,
        });
    }
  }

  async serverRequest(request, runtime) {
    if (!runtime || runtime.deleting || this.sessions.get(runtime.key) !== runtime || !["approval", "user-input"].includes(request.kind)) {
      await this.agent.reject(request, "当前会话不能处理此请求，未授予任何权限。");
      if (runtime && !runtime.deleting && this.sessions.get(runtime.key) === runtime)
        await this.publish(runtime, { type: "error", error: "暂不支持该执行器交互请求，已拒绝。" });
      return;
    }
    try {
      assertCapability(this.agent, request.kind === "user-input" ? "userInput" : "approvals");
      if (request.turnId && request.turnId !== runtime.turnId)
        throw new Error("该请求所属轮次已结束，无法提交回答。");
    } catch (error) {
      await this.agent.reject(request, error.message);
      await this.publish(runtime, { type: "error", error: error.message });
      return;
    }
    runtime.requests.set(request.id, request);
    await this.publish(runtime, { type: "requests", requests: [...runtime.requests.values()] });
  }

  async respond(key, requestId, response) {
    const runtime = this.sessions.get(key);
    const request = runtime?.requests.get(String(requestId));
    if (!request || !runtime.connected || (request.turnId && request.turnId !== runtime.turnId))
      throw new Error("该请求已失效，请刷新会话。");
    await this.agent.respond(request, response);
    runtime.requests.delete(request.id);
    await this.publish(runtime, { type: "requests", requests: [...runtime.requests.values()] });
  }
}

module.exports = { SessionEvents };
