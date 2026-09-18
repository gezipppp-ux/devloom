const { OUTPUT_LIMIT } = require("../domain/session-item.cjs");
const { SessionPresenter } = require("./session-presenter.cjs");

// Projects Codex notifications and interactive requests into one workspace's runtime.
class SessionEvents {
  constructor({ store, client, sessions, settings, emit, apiPrefix }) {
    this.store = store;
    this.client = client;
    this.sessions = sessions;
    this.settings = settings;
    this.emit = emit;
    this.presenter = new SessionPresenter({ store, settings, apiPrefix });
    this.pendingCallbacks = new Set();
    client.on("notification", (message) => this.notification(message));
    client.on("request", (message) => this.serverRequest(message));
    client.on("disconnected", (error) => this.disconnected(error));
  }

  disconnected(error) {
    for (const runtime of this.sessions.values()) {
      runtime.connected = false;
      runtime.requests.clear();
      if (runtime.turnId) {
        runtime.status = "disconnected";
        runtime.error = error.message;
      }
      clearTimeout(runtime.initial?.timer);
      runtime.initial?.reject(error);
      runtime.initial = null;
      this.publish(runtime, { type: "state" });
    }
  }

  publish(runtime, event) {
    runtime.lastActivity = new Date().toISOString();
    const data = {
      key: runtime.key,
      at: runtime.lastActivity,
      status: runtime.status,
      turnId: runtime.turnId,
      sessionId: runtime.sessionId,
      ...(event.type === "state" &&
      this.settings &&
      this.store.hasRun(runtime.key)
        ? this.settings.describe(runtime.key)
        : {}),
      ...event,
    };
    this.store.log(
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
    );
    this.emit(data);
  }

  persist(runtime) {
    const previous = this.store.readWeb(runtime.key);
    this.store.writeWeb(runtime.key, {
      ...previous,
      sessionId: runtime.sessionId,
      turnId: runtime.turnId,
      status: runtime.status,
      lastActivity: runtime.lastActivity,
    });
  }

  notification({ method, params = {} }) {
    const runtime = [...this.sessions.values()].find(
      (entry) =>
        entry.sessionId === params.threadId ||
        (method === "serverRequest/resolved" &&
          entry.requests.has(String(params.requestId))),
    );
    if (!runtime) return;
    try {
      if (method === "turn/started") {
        runtime.turnId = params.turn.id;
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
              initial.callbackError = error;
            });
          this.pendingCallbacks.add(initial.callback);
          void initial.callback.finally(() => {
            this.pendingCallbacks.delete(initial.callback);
          });
        } else if (!runtime.initial) {
          this.store.update(runtime.key, {
            execution: {
              status: "running",
              session_id: runtime.sessionId,
            },
          });
        }
        this.publish(runtime, { type: "state" });
        this.persist(runtime);
      } else if (method === "turn/completed") {
        void this.completed(runtime, params.turn).catch((error) => {
          runtime.error = error.message;
          runtime.status = "error";
          runtime.initial?.reject(error);
          this.publish(runtime, { type: "state", error: error.message });
        });
      } else if (method === "item/started" || method === "item/completed") {
        const previous = runtime.items.get(params.item.id);
        const item = this.presenter.item(
          runtime.key,
          params.item,
          params.turnId,
        );
        item.status =
          params.item.status ||
          (method === "item/started" ? "inProgress" : "completed");
        item.output ||= previous?.output || "";
        item.text ||= previous?.text || "";
        if (!item.images?.length && previous?.images)
          item.images = previous.images;
        runtime.items.set(item.id, item);
        this.publish(runtime, { type: "item", item });
      } else if (
        method === "item/agentMessage/delta" ||
        method === "item/commandExecution/outputDelta"
      ) {
        const isMessage = method === "item/agentMessage/delta";
        const item = runtime.items.get(params.itemId) || {
          id: params.itemId,
          turnId: params.turnId,
          type: isMessage ? "agentMessage" : "commandExecution",
          status: "inProgress",
          text: "",
          output: "",
        };
        const property = isMessage ? "text" : "output";
        item[property] = `${item[property] || ""}${params.delta || ""}`.slice(
          -OUTPUT_LIMIT,
        );
        runtime.items.set(item.id, item);
        this.publish(runtime, { type: "item", item });
      } else if (method === "serverRequest/resolved") {
        runtime.requests.delete(String(params.requestId));
        this.publish(runtime, {
          type: "requests",
          requests: [...runtime.requests.values()],
        });
      }
      while (runtime.items.size > 500)
        runtime.items.delete(runtime.items.keys().next().value);
    } catch (error) {
      runtime.error = error.message;
      this.emit({
        key: runtime.key,
        type: "error",
        error: error.message,
      });
    }
  }

  async completed(runtime, turn) {
    if (runtime.turnId && runtime.turnId !== turn.id) return;
    const initial = runtime.initial;
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
    }
    this.store.update(runtime.key, {
      execution: {
        status: turn.status,
        session_id: runtime.sessionId,
        completed: turn.status === "completed",
        error: runtime.error,
      },
    });
    this.publish(runtime, {
      type: "state",
      error: runtime.error,
      requests: [],
    });
    this.persist(runtime);
    const lastMessage = [...runtime.items.values()]
      .filter((item) => item.turnId === turn.id && item.type === "agentMessage")
      .at(-1);
    if (lastMessage) this.store.writeFinal(runtime.key, lastMessage.text);
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

  serverRequest(message) {
    const runtime = [...this.sessions.values()].find(
      (entry) => entry.sessionId === message.params?.threadId,
    );
    const supported = [
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/tool/requestUserInput",
    ];
    if (!runtime || !supported.includes(message.method)) {
      this.client.reject(
        message.id,
        "This Web CLI cannot handle this request. No permission was granted.",
      );
      if (runtime)
        this.publish(runtime, {
          type: "error",
          error: `暂不支持交互请求 ${message.method}，已拒绝。`,
        });
      return;
    }
    const request = {
      id: String(message.id),
      rpcId: message.id,
      method: message.method,
      params: message.params,
    };
    runtime.requests.set(request.id, request);
    this.publish(runtime, {
      type: "requests",
      requests: [...runtime.requests.values()],
    });
  }

  async respond(key, requestId, response) {
    const runtime = this.sessions.get(key);
    const request = runtime?.requests.get(String(requestId));
    if (!request || !runtime.connected)
      throw new Error("该请求已失效，请刷新会话。");
    let result;
    if (request.method === "item/tool/requestUserInput") {
      const answers = {};
      for (const question of request.params.questions) {
        const answer = response.answers?.[question.id];
        if (
          typeof answer !== "string" ||
          !answer.trim() ||
          answer.length > 20000
        )
          throw new Error("请回答每个问题。");
        answers[question.id] = { answers: [answer.trim()] };
      }
      result = { answers };
    } else {
      if (!["accept", "decline"].includes(response.decision))
        throw new Error("无效的审批决定。");
      result = { decision: response.decision };
    }
    this.client.respond(request.rpcId, result);
    runtime.requests.delete(request.id);
    this.publish(runtime, {
      type: "requests",
      requests: [...runtime.requests.values()],
    });
  }
}

module.exports = { SessionEvents };
