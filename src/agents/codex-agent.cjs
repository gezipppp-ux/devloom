const { EventEmitter } = require("node:events");
const { AppServerClient } = require("../codex/app-server-client.cjs");
const { listModels, validateModelSelection, resolveTurnModel } = require("../codex/models.cjs");
const { permissionOptions, assertPermissionAvailable, threadPermissionParams, turnPermissionParams } = require("../codex/permissions.cjs");
const { validatePermissionMode } = require("../domain/permissions.cjs");
const { USER_INPUT_METHOD, validateUserInput, userInputResponse } = require("../codex/user-input.cjs");
const { normalizeItem } = require("../codex/session-item.cjs");
const { supplierSelection } = require("../domain/agent-supplier.cjs");

function requestKey(id) { return `${typeof id}:${id}`; }
function turn(value) {
  return { id: value.id, status: value.status === "inProgress" ? "running" : value.status, error: value.error };
}
function nativeInput(input) {
  if (!Array.isArray(input)) throw new Error("无效的会话输入。");
  return input.map(part => {
    if (part?.type === "text" && typeof part.text === "string")
      return { type: "text", text: part.text, text_elements: [] };
    if (part?.type === "image" && typeof part.path === "string" && part.path)
      return { type: "localImage", path: part.path };
    throw new Error("无效的会话输入。");
  });
}

// Owns Codex RPC details. Applications consume only provider operations and events.
class CodexAgent extends EventEmitter {
  static capabilities = Object.freeze({ history: true, images: true, steer: true, approvals: true, userInput: true, resume: true });
  #client;
  #pending = new Map();
  #listeners;
  #closed = false;
  #closePromise;
  #supplier;

  constructor({ config = {}, client, gitCredentialProvider, gitCredentialRevision, supplier } = {}) {
    super();
    this.id = "codex";
    this.label = "Codex";
    this.capabilities = CodexAgent.capabilities;
    this.#supplier = supplier;
    this.#client = client || new AppServerClient(config, { gitCredentialProvider, gitCredentialRevision, supplier });
    this.#listeners = {
      notification: message => this.#receive(() => this.#notification(message)),
      request: message => this.#receive(() => this.#request(message)),
      disconnected: error => this.#disconnect(error),
    };
    for (const [name, listener] of Object.entries(this.#listeners)) this.#client.on(name, listener);
  }

  #receive(operation) {
    if (this.#closed) return;
    try { operation(); } catch (error) { this.#disconnect(error); }
  }

  #deliver(name, value) {
    for (const listener of this.rawListeners(name)) {
      try {
        const result = listener.call(this, value);
        if (result?.then) void Promise.resolve(result).catch(error => {
          if (name !== "disconnected") this.#disconnect(error);
        });
      } catch (error) {
        if (name !== "disconnected") this.#disconnect(error);
      }
    }
  }

  #disconnect(error) {
    if (this.#closed) return;
    this.#pending.clear();
    this.#deliver("disconnected", error);
  }

  connect() {
    if (this.#closed) return Promise.reject(new Error("会话执行器已关闭。"));
    return this.#client.connect();
  }
  validateCommand() { return this.#client.validateCommand?.(); }
  refreshGitCredentials() { return this.#client.refreshGitCredentials?.(); }
  listModels() {
    if (this.#supplier?.mode === "api-key") return Promise.resolve(this.#supplier.models.map(model => ({ ...model, isDefault: model.model === this.#supplier.defaultModel })));
    return listModels(this.#client);
  }
  permissionOptions() { return permissionOptions(this.#client); }
  assertPermissionAvailable(mode) { return assertPermissionAvailable(this.#client, mode); }

  async validateSelection(input) {
    if (this.#supplier?.mode === "api-key") return { ...supplierSelection(this.#supplier, input), permissionMode: validatePermissionMode(input?.permissionMode) };
    const selection = await validateModelSelection(this.#client, input);
    return { model: selection.model, reasoningEffort: selection.reasoning_effort, permissionMode: validatePermissionMode(input?.permissionMode) };
  }

  async prepareTurn(selection, cwd) {
    const permissionMode = validatePermissionMode(selection.permissionMode);
    await this.assertPermissionAvailable(permissionMode);
    if (this.#supplier?.mode === "api-key") {
      const requested = supplierSelection(this.#supplier, selection);
      const model = this.#supplier.models.find(entry => entry.model === (requested.model || this.#supplier.defaultModel));
      // A null turn effort preserves the previous thread override. Resolve an
      // actual default; an unknown custom model needs an administrator's value.
      let reasoningEffort = requested.reasoningEffort || model.defaultReasoningEffort;
      if (!reasoningEffort) {
        const native = (await listModels(this.#client)).find(entry => entry.model === model.model);
        if (native?.reasoningEfforts.includes(native.defaultReasoningEffort)) reasoningEffort = native.defaultReasoningEffort;
      }
      if (!reasoningEffort) throw new Error("无法确定该模型的默认思考强度，请管理员配置默认值，或选择具体思考强度后重试。");
      if (model.reasoningEfforts.length && !model.reasoningEfforts.includes(reasoningEffort))
        throw new Error("默认思考强度不受当前供应商模型支持，请管理员配置默认值，或重新选择。");
      return { model: model.model, reasoningEffort, permissionMode };
    }
    if (this.#supplier) await validateModelSelection(this.#client, selection);
    const resolved = await resolveTurnModel(this.#client, selection, cwd);
    return { model: resolved.model, reasoningEffort: resolved.effort, permissionMode };
  }

  async createSession({ cwd, selection }) {
    const result = await this.#client.request("thread/start", {
      cwd, ...threadPermissionParams(selection.permissionMode), ephemeral: false, model: selection.model,
      ...await this.#supplierParams(cwd, selection),
    });
    return { sessionId: result.thread.id };
  }

  async readSession(sessionId) {
    const result = await this.#client.request("thread/read", { threadId: sessionId, includeTurns: false });
    const status = result?.thread?.status?.type;
    // Codex uses notLoaded for persisted threads with no loaded runtime. Known
    // running turns are reported as active even before runtime loading settles.
    return { status: status === "active" ? "running" : ["idle", "notLoaded"].includes(status) ? "idle" : "unknown" };
  }

  async resumeSession({ sessionId, cwd, selection }) {
    await this.#client.request("thread/resume", {
      threadId: sessionId, cwd, ...threadPermissionParams(selection.permissionMode), excludeTurns: true,
      ...(selection.model ? { model: selection.model } : {}),
      ...await this.#supplierParams(cwd, selection),
    });
  }

  async #supplierParams(cwd, selection) {
    if (!this.#supplier) return {};
    if (this.#supplier.mode === "api-key") {
      const model = selection.model || this.#supplier.defaultModel;
      const effort = selection.reasoningEffort || this.#supplier.models.find(entry => entry.model === model)?.defaultReasoningEffort;
      return { modelProvider: "web_coding_supplier", model, ...(effort ? { config: { model_reasoning_effort: effort } } : {}) };
    }
    const result = await this.#client.request("config/read", { cwd, includeLayers: false });
    const config = result?.config;
    if (!config || typeof config !== "object") throw new Error("无法读取服务器现有 Codex 配置。");
    return { modelProvider: config.model_provider || "openai", ...(selection.model || config.model ? { model: selection.model || config.model } : {}) };
  }

  async startTurn({ sessionId, input, cwd, selection }) {
    const result = await this.#client.request("turn/start", {
      threadId: sessionId, input: nativeInput(input), model: selection.model, effort: selection.reasoningEffort,
      ...turnPermissionParams(selection.permissionMode, cwd),
    });
    return turn(result.turn);
  }

  async steerTurn({ sessionId, turnId, input }) {
    await this.#client.request("turn/steer", { threadId: sessionId, expectedTurnId: turnId, input: nativeInput(input) });
  }

  async interruptTurn({ sessionId, turnId }, timeout) {
    await this.#client.request("turn/interrupt", { threadId: sessionId, turnId }, timeout);
  }

  async listHistory({ sessionId, cursor, limit = 50 }) {
    const result = await this.#client.request("thread/items/list", {
      threadId: sessionId, limit, sortDirection: "desc", ...(cursor ? { cursor } : {}),
    });
    if (!Array.isArray(result?.data)) throw new Error("Codex 返回了无效的会话历史。");
    return { items: result.data.map(entry => normalizeItem(entry.item, entry.turnId)).reverse(), nextCursor: result.nextCursor ?? null };
  }

  #notification({ method, params = {} }) {
    const sessionId = params.threadId;
    if (method === "serverRequest/resolved") {
      const requestId = requestKey(params.requestId);
      const pending = this.#pending.get(requestId);
      if (pending && sessionId && sessionId !== pending.request.sessionId) return;
      this.#pending.delete(requestId);
      this.#deliver("event", { type: "request-resolved", sessionId: sessionId || pending?.request.sessionId, requestId });
    } else if (method === "turn/started" || method === "turn/completed") {
      if (method === "turn/completed") {
        for (const [id, pending] of this.#pending) if (pending.request.sessionId === sessionId &&
          (!pending.request.turnId || pending.request.turnId === params.turn.id)) this.#pending.delete(id);
      }
      this.#deliver("event", { type: method === "turn/started" ? "turn-started" : "turn-completed", sessionId, turn: turn(params.turn) });
    } else if (method === "item/started" || method === "item/completed") {
      const item = normalizeItem(params.item, params.turnId);
      item.status = params.item.status || (method === "item/started" ? "inProgress" : "completed");
      this.#deliver("event", { type: "item", sessionId, turnId: params.turnId, item });
    } else if (method === "item/agentMessage/delta" || method === "item/commandExecution/outputDelta") {
      this.#deliver("event", { type: "item-delta", sessionId, turnId: params.turnId, itemId: params.itemId,
        field: method === "item/agentMessage/delta" ? "text" : "output", delta: typeof params.delta === "string" ? params.delta : "" });
    }
  }

  #request(message) {
    const params = message.params || {};
    const request = { id: requestKey(message.id), sessionId: params.threadId, turnId: params.turnId, kind: "unsupported", blocking: true };
    // JSON-RPC ids identify outstanding requests globally on one connection.
    // A duplicate cannot replace ownership or be rejected without affecting
    // the original request sharing that same native id.
    if (this.#pending.has(request.id)) return;
    if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method)) {
      Object.assign(request, { kind: "approval", action: message.method === "item/commandExecution/requestApproval" ? "command" : "file-change",
        reason: params.reason, command: params.command, grantRoot: params.grantRoot });
    } else if (message.method === USER_INPUT_METHOD) {
      try {
        validateUserInput(params);
        Object.assign(request, { kind: "user-input", blocking: params.isBlocking !== false,
          questions: params.questions.map(question => ({ id: question.id, header: question.header, question: question.question,
            isOther: question.isOther, isSecret: question.isSecret,
            ...(question.options == null ? {} : { options: question.options.map(option => ({ label: option.label, description: option.description })) }) })) });
      } catch (error) { request.reason = error.message; }
    }
    this.#pending.set(request.id, { nativeId: message.id, method: message.method, params, request });
    this.#deliver("request", request);
  }

  async respond(request, response) {
    const pending = this.#pending.get(request.id);
    if (!pending || pending.request !== request) throw new Error("该请求已失效，请刷新会话。");
    let result;
    if (pending.request.kind === "user-input") result = userInputResponse(pending.params, response);
    else if (pending.request.kind === "approval") {
      if (!["accept", "decline"].includes(response?.decision)) throw new Error("无效的审批决定。");
      result = { decision: response.decision };
    } else throw new Error("暂不支持该交互请求。");
    await this.#client.respond(pending.nativeId, result);
    if (this.#pending.get(request.id) === pending) this.#pending.delete(request.id);
  }

  async reject(request, reason) {
    const pending = this.#pending.get(request.id);
    if (!pending || pending.request !== request) return;
    await this.#client.reject(pending.nativeId, reason || "This request is not supported. No permission was granted.");
    if (this.#pending.get(request.id) === pending) this.#pending.delete(request.id);
  }

  close() {
    if (!this.#closePromise) {
      this.#closed = true;
      this.#pending.clear();
      for (const [name, listener] of Object.entries(this.#listeners)) this.#client.removeListener(name, listener);
      this.#closePromise = Promise.resolve().then(() => this.#client.close());
      this.#deliver("disconnected", new Error("会话执行器已关闭。"));
    }
    return this.#closePromise;
  }
}

module.exports = { CodexAgent };
