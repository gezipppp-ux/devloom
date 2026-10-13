const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const { AgentSessionManager } = require("../../src/application/agent-session-manager.cjs");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { CodexAgent } = require("../../src/agents/codex-agent.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { writeConfig } = require("../../src/storage/json-files.cjs");
const { temporary } = require("../support/helpers.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");

function supplier(id, mode = "api-key") { return { id, name: id, mode, agentType: "codex", runtimeRevision: 1, selectionRevision: 1,
  models: [{ model: `${id}-model`, reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" }], defaultModel: `${id}-model` }; }
async function fixture(t) {
  const root = temporary(t), clients = [], leases = new Map();
  const suppliers = { current: supplier("A"), async selection() { return structuredClone(this.current); },
    async reserve(_workspace, key, value) { assert.equal(value.id, this.current.id); leases.set(key, { id: value.id, status: "reserved" }); return key; },
    async mark(_workspace, key, _token, status) { if (leases.has(key)) leases.get(key).status = status; } };
  const pool = new AgentSessionManager({ store: suppliers, workspaceId: "workspace", provider: {
    id: "codex", label: "Codex", capabilities: CodexAgent.capabilities, resolveCommand() {},
    create(options) { const client = new FakeClient(); client.turn = clients.length * 100; clients.push(client); return new CodexAgent({ ...options, client }); },
  } });
  const store = new RunStore(path.join(root, "runs"));
  const manager = new SessionManager({ agent: pool, store, configFile: path.join(root, "config.json"), worktreeReason: () => null });
  t.after(() => manager.close());
  for (const key of ["1-1", "1-2"]) await writeConfig(path.join(store.dir(key), "run.json"), {
    agent: { provider: "codex", model: "", reasoningEffort: "", permissionMode: "ask" },
    session_id: key, workitem: { title: key }, worktree: { path: root, branch: key }, execution: { status: "completed" },
  });
  return { suppliers, pool, manager, store, clients, leases, root };
}
test("supplier switches affect only the next turn and preserve active approvals, steering and session identity", async t => {
  const { manager, suppliers, clients, leases, store } = await fixture(t);
  const one = await manager.send("1-1", "first"); await manager.events.drain();
  const original = clients[0];
  assert.equal(one.sessionId, "1-1");
  suppliers.current = supplier("B");
  original.emit("request", { id: 7, method: "item/commandExecution/requestApproval", params: { threadId: one.sessionId, turnId: one.turnId, command: "fixture" } });
  await manager.events.drain();
  await manager.respond("1-1", "number:7", { decision: "accept" });
  assert.equal(original.calls.at(-1).response, 7);
  await manager.send("1-1", "steer");
  assert.equal(original.calls.at(-1).method, "turn/steer");
  const two = await manager.send("1-2", "independent"); await manager.events.drain();
  assert.equal(leases.get("1-2").id, "B");
  assert.equal(manager.sessions.get("1-1").connected, true);
  assert.equal(clients[1].calls.find(call => call.method === "thread/resume").params.threadId, "1-2");
  original.notify("turn/completed", { threadId: one.sessionId, turn: { id: one.turnId, status: "completed" } }); await manager.events.drain();
  assert.equal(leases.get("1-1").status, "idle");
  suppliers.current = supplier("C");
  const next = await manager.send("1-1", "next"); await manager.events.drain();
  assert.equal(next.sessionId, one.sessionId);
  assert.equal(leases.get("1-1").id, "C");
  assert.equal(manager.sessions.get("1-2").turnId, two.turnId);
  assert.equal(clients[2].calls.find(call => call.method === "thread/resume").params.modelProvider, "web_coding_supplier");
  assert.equal(clients[2].calls.find(call => call.method === "turn/start").params.model, "C-model");
  assert.equal(clients.flatMap(client => client.calls).some(call => call.method === "thread/start"), false);
  assert.equal((await store.read("1-1")).session_id, one.sessionId);
  assert.equal((await store.readExecutionSettings("1-1")).supplier.id, "C");
  original.notify("turn/started", { threadId: one.sessionId, turn: { id: "stale", status: "inProgress" } });
  await manager.events.drain(); assert.equal(manager.sessions.get("1-1").turnId, next.turnId);
});
test("incompatible models block dispatch; server configuration is restored explicitly without fallback", async t => {
  const { manager, suppliers, store, clients } = await fixture(t);
  await store.writeExecutionSettings("1-1", { selection: { model: "obsolete", reasoningEffort: "high", permissionMode: "ask" } });
  await assert.rejects(manager.send("1-1", "cannot send"), /重新选择/);
  assert.equal(clients.flatMap(client => client.calls).filter(call => call.method === "turn/start").length, 0);
  suppliers.current = supplier("server", "server-config");
  await store.writeExecutionSettings("1-1", { selection: { model: "", reasoningEffort: "", permissionMode: "ask" } });
  await manager.send("1-1", "continue");
  const resume = clients.at(-1).calls.find(call => call.method === "thread/resume");
  assert.equal(resume.params.threadId, "1-1"); assert.equal(resume.params.modelProvider, "openai");
});
test("clearing an effort resolves supplier or native defaults on the same connection and unknown defaults block dispatch", async t => {
  const { manager, suppliers, clients, store } = await fixture(t);
  suppliers.current.models.push(
    { model: "fixture-model-b", reasoningEfforts: ["low", "medium"], defaultReasoningEffort: "" },
    { model: "unknown-model", reasoningEfforts: [], defaultReasoningEffort: "" },
  );
  for (const [model, reasoningEffort, expected] of [
    ["A-model", "high", "high"], ["A-model", "", "low"], ["fixture-model-b", "", "medium"],
  ]) {
    await store.writeExecutionSettings("1-1", { selection: { model, reasoningEffort, permissionMode: "ask" } });
    const result = await manager.send("1-1", "next"); await manager.events.drain();
    assert.equal(clients.length, 1, "an effort change preserves the connected session");
    const start = clients[0].calls.filter(call => call.method === "turn/start").at(-1);
    assert.equal(start.params.threadId, "1-1"); assert.equal(start.params.model, model);
    assert.equal(start.params.effort, expected);
    clients[0].notify("turn/completed", { threadId: "1-1", turn: { id: result.turnId, status: "completed" } });
    await manager.events.drain();
  }
  await store.writeExecutionSettings("1-1", { selection: { model: "unknown-model", reasoningEffort: "", permissionMode: "ask" } });
  await assert.rejects(manager.send("1-1", "blocked"), /无法确定.*默认思考强度/);
  assert.equal(clients[0].calls.filter(call => call.method === "turn/start").length, 3);
});
test("discovery stays independent of active session scope and revision changes invalidate late lookups", async t => {
  const { pool, suppliers } = await fixture(t);
  await pool.withSession("1-1", () => pool.connect());
  suppliers.current = supplier("B");
  const models = await pool.withSession("1-1", () => pool.listModels());
  assert.equal(models[0].model, "B-model");
  assert.equal(pool.entries.get("1-1").supplier.id, "A");
  const discovery = pool.entries.get(undefined);
  discovery.agent.listModels = async () => { suppliers.current = supplier("C"); return []; };
  await assert.rejects(pool.listModels(), /已切换/);
});

test("key rotation waits for completion, unknown native state blocks sending, and disconnection affects only its run", async t => {
  const { manager, suppliers, clients, leases } = await fixture(t);
  const first = await manager.send("1-1", "first"); await manager.events.drain();
  const second = await manager.send("1-2", "second"); await manager.events.drain();
  suppliers.current.runtimeRevision++;
  await manager.send("1-1", "still the same turn");
  assert.equal(clients.length, 2);
  clients[0].emit("disconnected", new Error("fixture offline")); await manager.events.drain();
  assert.equal(manager.sessions.get("1-1").connected, false);
  assert.equal(manager.sessions.get("1-2").connected, true);
  assert.equal(manager.sessions.get("1-2").turnId, second.turnId);
  clients[0].notify("turn/completed", { threadId: "1-1", turn: { id: first.turnId, status: "completed" } }); await manager.events.drain();
  const native = clients[0].request.bind(clients[0]);
  clients[0].request = (method, params) => method === "thread/read" ? Promise.resolve({ thread: { status: { type: "future-unknown" } } }) : native(method, params);
  await assert.rejects(manager.send("1-1", "blocked"), /另一个客户端|空闲/);
  assert.equal(clients.length, 2);
  clients[0].request = native;
  await manager.send("1-1", "new key"); await manager.events.drain();
  assert.equal(clients.length, 3);
  assert.equal(manager.sessions.get("1-1").supplier.runtimeRevision, 2);
  assert.equal(leases.get("1-1").status, "active");
  assert.equal(clients[2].calls.find(call => call.method === "thread/resume").params.threadId, "1-1");
});

test("an unconfirmed start is never retried or silently routed to the server configuration", async t => {
  const { manager, pool, leases, clients } = await fixture(t);
  await pool.withSession("1-1", () => pool.connect());
  const entry = pool.entries.get("1-1");
  let starts = 0;
  entry.agent.startTurn = async () => { starts++; throw new Error("fixture timeout, outcome unknown"); };
  await assert.rejects(manager.send("1-1", "one attempt"), /outcome unknown/);
  assert.equal(starts, 1); assert.equal(clients.length, 1);
  assert.equal(leases.get("1-1").status, "unknown");
  assert.equal(entry.supplier.id, "A");
});
