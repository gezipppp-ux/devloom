const { EventEmitter } = require("node:events");
const { AsyncLocalStorage } = require("node:async_hooks");
const { getAgentProvider } = require("../agents/registry.cjs");
const { supplierSummary } = require("./agent-supplier-presenter.cjs");

// Owns one native connection per run. Scope is established by the application's
// operation/event queues; native session IDs also route out-of-band interrupts.
class AgentSessionManager extends EventEmitter {
  constructor({ store, workspaceId, config, gitCredentialProvider, gitCredentialRevision, provider = getAgentProvider("codex"), idle = () => false }) {
    super(); this.store = store; this.workspaceId = workspaceId; this.provider = provider;
    this.id = provider.id; this.label = provider.label; this.capabilities = provider.capabilities;
    this.options = { config, gitCredentialProvider, gitCredentialRevision };
    this.scope = new AsyncLocalStorage(); this.entries = new Map(); this.pending = new Map(); this.closed = false; this.idle = idle;
    this.requestOwners = new WeakMap();
    this.retiring = new Map(); this.connections = new Set();
  }
  withSession(key, operation) { return this.scope.run(key, operation); }
  identity(supplier) { return `${supplier.id}:${supplier.runtimeRevision}`; }
  validateCommand() { return this.provider.resolveCommand(this.options.config); }
  async get(key) {
    if (!arguments.length) key = this.scope.getStore();
    if (this.closed) throw new Error("会话执行器已关闭。");
    if (this.retiring.has(key)) await this.retiring.get(key);
    if (this.closed) throw new Error("会话执行器已关闭。");
    if (this.entries.has(key)) return this.entries.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    const pending = this.create(key);
    this.pending.set(key, pending);
    try { return await pending; } finally { if (this.pending.get(key) === pending) this.pending.delete(key); }
  }
  async create(key, supplier) {
    supplier ||= await this.store.selection(this.id, true);
    if (this.closed) throw new Error("会话执行器已关闭。");
    const agent = this.provider.create({ ...this.options, supplier });
    const entry = { agent, supplier, key, sessionId: null, token: null, dispatched: false };
    this.connections.add(entry);
    this.entries.set(key, entry);
    for (const type of ["event", "request"]) agent.on(type, value => {
      if (this.entries.get(key) !== entry || this.closed) return;
      if (value.sessionId && entry.sessionId && value.sessionId !== entry.sessionId) return;
      if (type === "request") this.requestOwners.set(value, entry);
      if (key !== undefined) this.emit(type, value);
    });
    agent.on("disconnected", error => {
      if (this.entries.get(key) === entry && key !== undefined) this.emit("disconnected", error, key);
    });
    this.schedule(entry);
    return entry;
  }
  schedule(entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(async () => {
      if (this.entries.get(entry.key) !== entry || this.closed) return;
      if (entry.calls || entry.dispatched || (entry.key !== undefined && !this.idle(entry.key))) { this.schedule(entry); return; }
      this.entries.delete(entry.key);
      if (entry.key !== undefined) this.emit("disconnected", new Error("空闲连接已释放，发送时将恢复原会话。"), entry.key);
      try { await this.dispose(entry); } catch { /* History and run identity remain saved. */ }
    }, 60000);
    entry.timer.unref?.();
  }
  dispose(entry) {
    if (entry.closing) return entry.closing;
    clearTimeout(entry.timer);
    const pending = Promise.resolve().then(() => entry.agent.close()).finally(() => {
      this.connections.delete(entry);
      if (this.retiring.get(entry.key) === pending) this.retiring.delete(entry.key);
    });
    entry.closing = pending; this.retiring.set(entry.key, pending);
    return pending;
  }
  async discovery() {
    const supplier = await this.store.selection(this.id, true);
    let entry = this.entries.get(undefined);
    if (entry && this.identity(entry.supplier) !== this.identity(supplier)) {
      // Keep an in-flight lookup alive; it must fail its revision check below.
      this.entries.delete(undefined);
      entry.retired = true;
      if (!entry.calls) await this.dispose(entry);
      entry = null;
    }
    entry ||= await this.get(undefined);
    return entry;
  }
  async discover(method, args = []) {
    const entry = await this.discovery(); entry.calls = (entry.calls || 0) + 1;
    try {
      const result = await entry.agent[method](...args);
      const current = await this.store.selection(this.id);
      if (this.identity(current) !== this.identity(entry.supplier)) throw new Error("供应商已切换，请刷新模型和执行选项。");
      return result;
    } finally {
      entry.calls--;
      if (entry.retired && !entry.calls) await this.dispose(entry);
      else this.schedule(entry);
    }
  }
  listModels() { return this.discover("listModels"); }
  permissionOptions() { return this.discover("permissionOptions"); }
  validateSelection(input) { return this.discover("validateSelection", [input]); }
  async currentSummary() { return supplierSummary(await this.store.selection(this.id)); }
  async describeSupplier(key) {
    const nextSupplier = await this.currentSummary();
    return { nextSupplier, ...(this.entries.get(key)?.supplier ? { connectedSupplier: supplierSummary(this.entries.get(key).supplier) } : {}) };
  }
  async prepare(key, runtime) {
    if (this.closed) throw new Error("会话执行器已关闭。");
    const supplier = await this.store.selection(this.id, true);
    let entry = await this.get(key);
    if (runtime?.turnId || runtime?.requests.size || runtime?.pipelineActive) throw new Error("请等待当前轮次及交互结束后切换供应商。");
    if (runtime?.sessionId) {
      await entry.agent.connect();
      const state = await entry.agent.readSession(runtime.sessionId);
      if (state.status !== "idle") throw new Error("无法确认原会话空闲，请刷新会话状态后重试。");
    }
    let replaced = false;
    if (this.identity(entry.supplier) !== this.identity(supplier)) {
      this.entries.delete(key); clearTimeout(entry.timer);
      await this.dispose(entry);
      entry = await this.create(key, supplier); replaced = true;
    } else entry.supplier = supplier;
    if (await entry.agent.refreshGitCredentials?.()) replaced = true;
    entry.token = await this.store.reserve(this.workspaceId, key, supplier);
    entry.dispatched = false;
    return { replaced, supplier: supplierSummary(supplier) };
  }
  async cancelPreparation(key) {
    const entry = this.entries.get(key);
    if (entry && !entry.dispatched) await this.store.mark(this.workspaceId, key, entry.token, "idle");
  }
  async recordTurnEvent(key, event) {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (event.type === "turn-completed") {
      await this.store.mark(this.workspaceId, key, entry.token, "idle"); entry.dispatched = false; this.schedule(entry);
    }
  }
  async invoke(method, args) {
    const id = typeof args[0] === "string" && method === "readSession" ? args[0] : args[0]?.sessionId;
    const found = (["respond", "reject"].includes(method) && this.requestOwners.get(args[0])) ||
      (id && [...this.entries.values()].find(entry => entry.sessionId === id));
    const entry = found || await this.get();
    const token = entry.token;
    if (id) entry.sessionId = id;
    entry.calls = (entry.calls || 0) + 1;
    try {
      if (method === "startTurn") {
        await this.store.mark(this.workspaceId, entry.key, entry.token, "active");
        entry.dispatched = token;
      }
      const result = await entry.agent[method](...args);
      if (method === "createSession") entry.sessionId = result.sessionId;
      return result;
    } catch (error) {
      if (method === "startTurn" && entry.dispatched === token) await this.store.mark(this.workspaceId, entry.key, token, "unknown");
      throw error;
    } finally { entry.calls--; this.schedule(entry); }
  }
  connect() { return this.invoke("connect", []); }
  assertPermissionAvailable(mode) { return this.invoke("assertPermissionAvailable", [mode]); }
  prepareTurn(selection, cwd) { return this.invoke("prepareTurn", [selection, cwd]); }
  createSession(input) { return this.invoke("createSession", [input]); }
  readSession(id) { return this.invoke("readSession", [id]); }
  resumeSession(input) { return this.invoke("resumeSession", [input]); }
  startTurn(input) { return this.invoke("startTurn", [input]); }
  steerTurn(input) { return this.invoke("steerTurn", [input]); }
  interruptTurn(input, timeout) { return this.invoke("interruptTurn", [input, timeout]); }
  listHistory(input) { return this.invoke("listHistory", [input]); }
  respond(request, response) { return this.invoke("respond", [request, response]); }
  reject(request, reason) { return this.invoke("reject", [request, reason]); }
  async refreshGitCredentials() {
    for (const entry of this.entries.values()) if (!entry.dispatched && !entry.calls) await entry.agent.refreshGitCredentials?.();
  }
  async forget(key) {
    const entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); await this.dispose(entry); }
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.pending.values()]);
    const entries = [...this.connections]; this.entries.clear();
    await Promise.allSettled(entries.map(entry => this.dispose(entry)));
  }
}
module.exports = { AgentSessionManager };
