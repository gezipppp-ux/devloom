const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { setImmediate: nextTick } = require("node:timers/promises");
const { test } = require("node:test");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { writeConfig } = require("../../src/storage/json-files.cjs");
const { sourceFor, runKey } = require("../../src/domain/run-identity.cjs");
const { temporary, png } = require("../support/helpers.cjs");

// This is an injected contract double, not a registered second provider. It has
// no request() method, native transport, protocol translator or Codex dependency.
class FixtureAgent extends EventEmitter {
  constructor(capabilities = {}) {
    super();
    this.id = "fixture";
    this.label = "Fixture agent";
    this.capabilities = { images: true, resume: true, steer: true, history: true,
      approvals: true, userInput: true, ...capabilities };
    this.calls = [];
    this.turns = [];
    this.historyItems = [];
  }
  record(operation, input) { this.calls.push({ operation, input }); }
  async connect() { this.record("connect"); }
  validateCommand() { this.record("validateCommand"); }
  async refreshGitCredentials() { this.record("refreshGitCredentials"); }
  async validateSelection(input) {
    this.record("validateSelection", input);
    return { model: input.model || "fixture-model", reasoningEffort: input.reasoningEffort || "high",
      permissionMode: input.permissionMode || "ask" };
  }
  async assertPermissionAvailable(mode) {
    this.record("assertPermissionAvailable", mode);
    if (mode === "full") throw new Error("fixture permission denied");
  }
  async prepareTurn(selection, cwd) { this.record("prepareTurn", { selection, cwd }); return selection; }
  async createSession(input) { this.record("createSession", input); return { sessionId: "fixture-session" }; }
  async readSession(sessionId) { this.record("readSession", sessionId); return { status: "idle" }; }
  async resumeSession(input) { this.record("resumeSession", input); }
  async startTurn(input) {
    this.record("startTurn", input);
    const turn = { id: `fixture-turn-${this.turns.length + 1}`, status: "running" };
    this.turns.push(turn);
    return turn;
  }
  async steerTurn(input) { this.record("steerTurn", input); }
  async interruptTurn(input) { this.record("interruptTurn", input); }
  async listHistory(input) {
    this.record("listHistory", input);
    return { items: this.historyItems, nextCursor: "next-page" };
  }
  async respond(request, response) { this.record("respond", { request, response }); }
  async reject(request, reason) { this.record("reject", { request, reason }); }
  async close() { this.record("close"); await this.closeGate; }
  notify(type, turn, extra = {}) {
    this.emit("event", { type, sessionId: "fixture-session", ...(turn ? { turn } : {}), ...extra });
  }
}

function fixture(t, { capabilities, onStarted } = {}) {
  const root = temporary(t);
  const agent = new FixtureAgent(capabilities);
  const store = new RunStore(path.join(root, "runs"));
  const item = { id: "contract", workspace_id: "scope", title: "Agent contract" };
  const source = sourceFor("fixture", item);
  const key = runKey(source);
  const config = { agent: { provider: agent.id, startupTimeoutMs: 3000 },
    execution: { repository: root, worktreeRoot: path.join(root, "trees"), initCommands: [] } };
  const state = { agent: { provider: agent.id }, source, workitem: item,
    worktree: { path: root, branch: "contract/fixture" },
    execution: { status: "starting" }, transition: { status: "not_started" } };
  let started = 0;
  const manager = new SessionManager({
    agent, store, configFile: path.join(root, "config.json"), worktreeReason: () => null,
    channels: { get: () => ({ id: "fixture", resolve: async () => ({ item, config, session: null }) }) },
    async run(_input, { startSession }) {
      await writeConfig(path.join(store.dir(key), "run.json"), state);
      await writeConfig(path.join(store.dir(key), "requirement.json"), {
        prompt: "Implement the fixture", images: [], workitem: item,
      });
      const result = await startSession({
        repository: root, task: { prompt: "Implement the fixture", images: [] },
        async onSession(id) { await store.update(key, { session_id: id }); },
        async onStarted() {
          started++;
          await onStarted?.();
          await store.update(key, { execution_started_at: new Date().toISOString(), execution: { status: "running" } });
        },
      });
      await store.update(key, { execution: { ...result, status: result.status } });
      return store.read(key);
    },
  });
  t.after(() => manager.close());
  return { agent, manager, store, key, config, state, root, started: () => started };
}

async function waitForTurn(agent, count = 1) {
  for (let index = 0; index < 200; index++) {
    if (agent.turns.length >= count) return agent.turns[count - 1];
    await nextTick();
  }
  assert.fail("The contract double did not receive a turn");
}

async function saveIdle(context, agentConfig = { provider: "fixture" }) {
  const state = { ...context.state, session_id: "fixture-session", execution: { status: "completed" } };
  if (agentConfig) state.agent = agentConfig;
  else delete state.agent;
  await writeConfig(path.join(context.store.dir(context.key), "run.json"), state);
}

test("production SessionManager runs a protocol-free Agent through creation, events, images, steering and history", { timeout: 10000 }, async (t) => {
  const context = fixture(t);
  const { agent, manager, store, key } = context;
  assert.equal(agent.request, undefined);
  const accepted = await manager.start({ channel: "fixture", model: "fixture-selected", permissionMode: "ask" });
  assert.equal(accepted.key, key);
  const first = await waitForTurn(agent);
  await manager.events.drain();
  assert.equal(context.started(), 0, "an accepted start response is not proof of execution");
  assert.equal((await store.read(key)).execution_started_at, undefined);
  assert.deepEqual(agent.calls.find(call => call.operation === "startTurn").input.input,
    [{ type: "text", text: "Implement the fixture" }]);
  agent.notify("turn-started", first);
  await manager.events.drain();
  await Promise.all([...manager.events.pendingCallbacks]);
  assert.equal(context.started(), 1);
  assert.ok((await store.read(key)).execution_started_at);
  agent.notify("item", null, { turnId: first.id, item: {
    id: "answer", turnId: first.id, type: "agentMessage", text: "Completed fixture", status: "completed",
  } });
  agent.notify("turn-completed", { ...first, status: "completed" });
  await manager.events.drain();
  await manager.sessions.get(key).operation;
  assert.equal((await store.read(key)).execution.status, "completed");
  assert.equal(fs.readFileSync(path.join(store.dir(key), "final.md"), "utf8"), "Completed fixture");

  manager.sessions.get(key).connected = false;
  const uploaded = await manager.uploadMessageImage(key, png);
  const next = await manager.send(key, "Continue with this image", [uploaded.id]);
  assert.equal(next.sessionId, "fixture-session");
  const sent = agent.calls.filter(call => call.operation === "startTurn").at(-1).input;
  assert.equal(sent.input[0].text, "Continue with this image");
  assert.equal(sent.input[1].type, "image");
  assert.deepEqual(fs.readFileSync(sent.input[1].path), png);
  assert.equal(agent.calls.filter(call => call.operation === "createSession").length, 1);
  assert.equal(agent.calls.filter(call => call.operation === "resumeSession").length, 1);
  await manager.send(key, "Adjust the active turn");
  assert.equal(agent.calls.at(-1).operation, "steerTurn");
  assert.equal(agent.calls.at(-1).input.turnId, next.turnId);
  await manager.interrupt(key);
  assert.equal(agent.calls.at(-1).operation, "interruptTurn");
  assert.equal(manager.sessions.get(key).status, "running", "interrupt acceptance is not completion");
  agent.notify("turn-completed", { id: next.turnId, status: "interrupted" });
  await manager.events.drain();
  assert.equal((await store.read(key)).execution.status, "interrupted");
  agent.historyItems = [{ id: "history", type: "agentMessage", turnId: first.id, text: "Normalized history" }];
  const history = await manager.history(key, "page-2");
  assert.equal(history.items[0].text, "Normalized history");
  assert.equal(history.nextCursor, "next-page");
  assert.equal(agent.calls.at(-1).input.cursor, "page-2");
});

test("Agent permission rejection prevents creation and leaves saved selection unchanged", async (t) => {
  const context = fixture(t);
  await assert.rejects(context.manager.start({ channel: "fixture", permissionMode: "full" }), /fixture permission denied/);
  assert.equal(context.agent.calls.some(call => call.operation === "createSession"), false);
  await saveIdle(context);
  await assert.rejects(context.manager.updateExecutionSettings(context.key, { permissionMode: "full" }), /fixture permission denied/);
  assert.equal((await context.manager.settings.read(context.key)).selection.permissionMode, "ask");
});

test("normalized approval requests block continuation and unsupported requests await rejection", async (t) => {
  const context = fixture(t);
  const { agent, manager, key } = context;
  await saveIdle(context);
  const runtime = manager.runtime(key, "fixture-session");
  runtime.connected = true;
  runtime.turnId = "active";
  const request = { id: "permission", sessionId: "fixture-session", turnId: "active",
    kind: "approval", action: "command", reason: "Fixture permission" };
  agent.emit("request", request);
  await manager.events.drain();
  await assert.rejects(manager.send(key, "wait for approval"), /先处理当前等待/);
  await manager.respond(key, request.id, { decision: "accept" });
  assert.deepEqual(agent.calls.at(-1), { operation: "respond", input: { request, response: { decision: "accept" } } });
  assert.equal(runtime.requests.size, 0);

  const rejection = Promise.withResolvers();
  let rejected = false;
  agent.reject = async () => { await rejection.promise; rejected = true; };
  agent.emit("request", { ...request, id: "unsupported", kind: "not-supported" });
  let drained = false;
  const draining = manager.events.drain().then(() => { drained = true; });
  try {
    await nextTick();
    assert.equal(drained, false);
    rejection.resolve();
    await draining;
    assert.equal(rejected, true);
    assert.equal(runtime.requests.size, 0);
  } finally {
    rejection.resolve();
    await draining;
    runtime.turnId = null;
  }
});

test("unavailable images, steering, resume and history fail at the neutral capability boundary", async (t) => {
  const context = fixture(t, { capabilities: { images: false, steer: false, resume: false, history: false } });
  const { manager, agent, key } = context;
  await saveIdle(context);
  await assert.rejects(manager.uploadMessageImage(key, png), /images/);
  await assert.rejects(manager.attach(key), /resume/);
  await assert.rejects(manager.history(key), /history/);
  assert.deepEqual(agent.calls, []);
  agent.capabilities.resume = true;
  const runtime = manager.runtime(key, "fixture-session");
  runtime.connected = true;
  runtime.turnId = "active";
  await assert.rejects(manager.send(key, "steer unavailable"), /steer/);
  assert.equal(agent.calls.some(call => call.operation === "steerTurn"), false);
  runtime.turnId = null;
});

test("missing, unknown and mismatched recorded providers reject session actions before Agent calls", async (t) => {
  for (const recorded of [null, {}, { provider: "unregistered-provider" }, { provider: "codex" }]) {
    const context = fixture(t);
    const { manager, agent, key } = context;
    await saveIdle(context, recorded);
    for (const operation of [() => manager.attach(key), () => manager.history(key),
      () => manager.send(key, "must not dispatch"), () => manager.uploadMessageImage(key, png),
      () => manager.updateExecutionSettings(key, { model: "other" })]) {
      await assert.rejects(operation(), /agent.provider|执行器.*不一致/);
      assert.deepEqual(agent.calls, []);
    }
    const runtime = manager.runtime(key, "fixture-session");
    runtime.connected = true;
    runtime.turnId = "active";
    runtime.requests.set("approval", { id: "approval", kind: "approval", turnId: "active" });
    await assert.rejects(manager.interrupt(key), /agent.provider|执行器.*不一致/);
    await assert.rejects(manager.respond(key, "approval", { decision: "accept" }), /agent.provider|执行器.*不一致/);
    assert.deepEqual(agent.calls, []);
    runtime.connected = false;
  }
});

test("closing waits for pending Agent close and an accepted start callback", { timeout: 10000 }, async (t) => {
  const callback = Promise.withResolvers();
  const closingAgent = Promise.withResolvers();
  const context = fixture(t, { onStarted: () => callback.promise });
  const { manager, agent, key, store } = context;
  agent.closeGate = closingAgent.promise;
  await manager.start({ channel: "fixture" });
  const first = await waitForTurn(agent);
  agent.notify("turn-started", first);
  await manager.events.drain();
  let closed = false;
  const closing = manager.close().then(() => { closed = true; });
  try {
    await nextTick();
    assert.equal(closed, false);
    closingAgent.resolve();
    await nextTick();
    assert.equal(closed, false);
    assert.equal(fs.existsSync(path.join(store.dir(key), "web-owner.json")), true);
    callback.resolve();
    await closing;
    assert.equal(fs.existsSync(path.join(store.dir(key), "web-owner.json")), false);
    await assert.rejects(manager.send(key, "too late"), /正在关闭/);
  } finally {
    callback.resolve();
    closingAgent.resolve();
    await closing;
  }
});
