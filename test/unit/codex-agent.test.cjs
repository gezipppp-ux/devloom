const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { CodexAgent } = require("../../src/agents/codex-agent.cjs");
const { createAgent, getAgentProvider } = require("../../src/agents/registry.cjs");

function fixture(results = {}) {
  const client = new EventEmitter();
  const calls = [];
  client.connect = async () => {};
  client.close = async () => {};
  client.request = async (method, params, timeout) => {
    calls.push({ method, params, timeout });
    return typeof results[method] === "function" ? results[method](params) : results[method];
  };
  client.respond = (id, response) => calls.push({ response, id });
  client.reject = (id, reason) => calls.push({ rejected: true, id, reason });
  const agent = createAgent({ client });
  return { client, agent, calls };
}

const selection = { model: "model-1", reasoningEffort: "high", permissionMode: "ask" };

test("provider registry only accepts explicitly implemented providers", () => {
  assert.equal(getAgentProvider().id, "codex");
  assert.equal(getAgentProvider().runTask, undefined);
  assert.equal(typeof getAgentProvider().resolveCommand, "function");
  for (const id of ["claude", "pi", "../codex", null, {}, ""]) assert.throws(() => createAgent({ provider: id }), /不支持/);
  const { agent } = fixture();
  assert.ok(agent instanceof CodexAgent);
  assert.deepEqual(agent.capabilities, { history: true, images: true, steer: true, approvals: true, userInput: true, resume: true });
  assert.equal(agent.request, undefined);
});

test("session and turn operations translate input and native state behind the provider", async () => {
  const { agent, calls } = fixture({
    "thread/start": { thread: { id: "session" } },
    "turn/start": { turn: { id: "turn", status: "inProgress" } },
  });
  const cwd = path.resolve(".");
  assert.deepEqual(await agent.createSession({ cwd, selection }), { sessionId: "session" });
  assert.equal(calls[0].params.ephemeral, false);
  assert.equal(calls[0].params.approvalPolicy, "on-request");
  await agent.resumeSession({ sessionId: "session", cwd, selection });
  assert.equal(calls[1].params.excludeTurns, true);
  const input = [{ type: "text", text: "hello" }, { type: "image", path: "/image.png" }];
  const result = await agent.startTurn({ sessionId: "session", cwd, selection, input });
  assert.equal(result.status, "running");
  assert.deepEqual(calls[2].params.input, [{ type: "text", text: "hello", text_elements: [] }, { type: "localImage", path: "/image.png" }]);
  assert.equal(calls[2].params.effort, "high");
  await agent.steerTurn({ sessionId: "session", turnId: "turn", input });
  assert.equal(calls[3].params.expectedTurnId, "turn");
  await agent.interruptTurn({ sessionId: "session", turnId: "turn" }, 123);
  assert.equal(calls[4].timeout, 123);
  await assert.rejects(agent.startTurn({ sessionId: "session", cwd, selection, input: [{ type: "localImage", path: "/x" }] }), /输入/);
});

test("known idle and unloaded native sessions can resume while unknown states stay unknown", async () => {
  for (const [native, expected] of [["idle", "idle"], ["active", "running"], ["notLoaded", "idle"], ["systemError", "unknown"], ["futureState", "unknown"], [undefined, "unknown"]]) {
    const { agent } = fixture({ "thread/read": { thread: { status: { type: native } } } });
    assert.deepEqual(await agent.readSession("session"), { status: expected });
  }
});

test("new and resumed sessions combine supplier selection with the current Git identity policy", async () => {
  const { client, calls } = fixture({ "thread/start": { thread: { id: "session" } } });
  const agent = new CodexAgent({ client, supplier: { mode: "api-key", defaultModel: "supplier-model", models: [] } });
  const environment = { set: { GIT_AUTHOR_NAME: "Chosen" } }, cwd = path.resolve(".");
  client.gitIdentityConfig = async directory => {
    assert.equal(directory, cwd);
    return { shell_environment_policy: environment };
  };
  await agent.createSession({ cwd, selection });
  await agent.resumeSession({ sessionId: "session", cwd, selection });
  for (const call of calls) {
    assert.equal(call.params.modelProvider, "web_coding_supplier");
    assert.equal(call.params.config.model_reasoning_effort, "high");
    assert.deepEqual(call.params.config.shell_environment_policy, environment);
  }
  await agent.close();
});

test("selection validation and dispatch preparation resolve concrete defaults", async () => {
  const { agent, calls } = fixture({
    "config/read": { config: { model: "model-1", model_reasoning_effort: "high" } },
    "model/list": { data: [{ model: "model-1", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "high" }], defaultReasoningEffort: "high" }] },
  });
  assert.deepEqual(await agent.validateSelection(selection), selection);
  assert.deepEqual(await agent.prepareTurn({ model: "", reasoningEffort: "", permissionMode: "full" }, path.resolve(".")), { ...selection, permissionMode: "full" });
  assert.ok(calls.some(call => call.method === "config/read"));
  await assert.rejects(agent.validateSelection({ model: "not-available" }), /不在/);
});

test("native notifications and history expose normalized items with image references", async () => {
  const bytes = Buffer.from("image");
  const userItem = { id: "user", type: "userMessage", content: [{ type: "text", text: "hello" }, { type: "localImage", path: "/image.png" }, { type: "image", url: `data:image/png;base64,${bytes.toString("base64")}` }] };
  const { client, agent } = fixture({ "thread/items/list": { data: [{ item: { id: "agent", type: "agent_message", text: "answer" }, turnId: "turn" }, { item: userItem, turnId: "turn" }], nextCursor: "next" } });
  const events = [];
  agent.on("event", event => events.push(event));
  client.emit("notification", { method: "turn/started", params: { threadId: "session", turn: { id: "turn", status: "inProgress" } } });
  client.emit("notification", { method: "item/started", params: { threadId: "session", turnId: "turn", item: userItem } });
  client.emit("notification", { method: "item/agentMessage/delta", params: { threadId: "session", turnId: "turn", itemId: "agent", delta: "answer" } });
  client.emit("notification", { method: "item/commandExecution/outputDelta", params: { threadId: "session", turnId: "turn", itemId: "command", delta: "output" } });
  assert.equal(events[0].turn.status, "running");
  assert.equal(events[1].item.status, "inProgress");
  assert.equal(events[1].item.content, undefined);
  assert.deepEqual(events[1].item.imageSources, [{ path: "/image.png" }, { sha256: createHash("sha256").update(bytes).digest("hex") }]);
  assert.equal(events[2].field, "text");
  assert.equal(events[3].field, "output");
  const history = await agent.listHistory({ sessionId: "session" });
  assert.deepEqual(history.items.map(item => item.id), ["user", "agent"]);
  assert.equal(history.nextCursor, "next");
  assert.equal(history.items[0].turnId, "turn");
});

test("opaque request identities preserve native number and string ids independently", async () => {
  const { client, agent, calls } = fixture();
  const requests = [];
  const events = [];
  agent.on("request", request => requests.push(request));
  agent.on("event", event => events.push(event));
  for (const id of [1, "1"]) client.emit("request", { id, method: "item/commandExecution/requestApproval", params: { threadId: "session", turnId: "turn", reason: "permission", command: "git status", private: "hidden" } });
  assert.notEqual(requests[0].id, requests[1].id);
  assert.equal(requests[0].method, undefined);
  assert.equal(requests[0].params, undefined);
  assert.equal(requests[0].rpcId, undefined);
  await assert.rejects(agent.respond(requests[0], { decision: "anything" }), /无效/);
  await agent.respond(requests[0], { decision: "accept" });
  assert.equal(calls[0].id, 1);
  client.emit("notification", { method: "serverRequest/resolved", params: { requestId: "1" } });
  assert.equal(events[0].requestId, requests[1].id);
  assert.equal(events[0].sessionId, "session");
  await assert.rejects(agent.respond(requests[1], { decision: "accept" }), /失效/);
});

test("questions stay provider-neutral while native response validation stays in adapter", async () => {
  const { client, agent, calls } = fixture();
  const requests = [];
  agent.on("request", request => requests.push(request));
  client.emit("request", { id: 1, method: "item/tool/requestUserInput", params: { threadId: "session", turnId: "turn", isBlocking: false, questions: [{ id: "q", question: "Which?", options: [{ label: "One", description: "First" }], secretNative: "hidden" }] } });
  assert.equal(requests[0].kind, "user-input");
  assert.equal(requests[0].blocking, false);
  assert.equal(requests[0].questions[0].secretNative, undefined);
  await assert.rejects(agent.respond(requests[0], { answers: {} }), /每个问题/);
  await agent.respond(requests[0], { answers: { q: " One " } });
  assert.deepEqual(calls[0], { id: 1, response: { answers: { q: { answers: ["One"] } } } });
  for (const message of [{ id: 2, method: "item/tool/requestUserInput", params: { questions: [] } }, { id: 3, method: "unknown" }]) client.emit("request", message);
  assert.equal(requests[1].kind, "unsupported");
  assert.equal(requests[2].kind, "unsupported");
  await agent.reject(requests[1], "invalid");
  await agent.reject(requests[2], "unsupported");
  assert.deepEqual(calls.slice(1).map(call => call.id), [2, 3]);
});

test("foreign request resolution cannot invalidate the owning session's pending request", async () => {
  const { client, agent, calls } = fixture();
  let request;
  const events = [];
  agent.on("request", value => { request = value; });
  agent.on("event", value => events.push(value));
  client.emit("request", { id: 1, method: "item/commandExecution/requestApproval", params: { threadId: "owner", turnId: "turn" } });
  client.emit("notification", { method: "serverRequest/resolved", params: { threadId: "foreign", requestId: 1 } });
  assert.deepEqual(events, []);
  await agent.respond(request, { decision: "accept" });
  assert.deepEqual(calls, [{ id: 1, response: { decision: "accept" } }]);
});

test("terminal close emits one disconnect, fences late events and waits for native cleanup", async () => {
  const { client, agent } = fixture();
  let request;
  const events = [];
  const disconnected = [];
  let finishCleanup;
  let nativeCloses = 0;
  agent.on("request", value => { request = value; });
  agent.on("event", value => events.push(value));
  agent.on("disconnected", error => disconnected.push(error));
  client.close = async () => {
    nativeCloses++;
    client.emit("disconnected", new Error("native closed"));
    await new Promise(resolve => { finishCleanup = resolve; });
  };
  client.emit("request", { id: 1, method: "item/fileChange/requestApproval", params: { threadId: "session" } });
  const pendingRequest = request;
  const closing = agent.close();
  assert.equal(agent.close(), closing);
  assert.equal(disconnected.length, 1);
  assert.match(disconnected[0].message, /关闭/);
  await assert.rejects(agent.respond(pendingRequest, { decision: "accept" }), /失效/);
  let completed = false;
  void closing.then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(nativeCloses, 1);
  assert.equal(completed, false);
  client.emit("notification", { method: "turn/started", params: { threadId: "session", turn: { id: "turn", status: "inProgress" } } });
  client.emit("request", { id: 2, method: "item/fileChange/requestApproval", params: { threadId: "session" } });
  client.emit("disconnected", new Error("late disconnect"));
  assert.equal(request, pendingRequest);
  assert.deepEqual(events, []);
  assert.equal(disconnected.length, 1);
  finishCleanup();
  await closing;
  assert.equal(completed, true);
  assert.equal(disconnected.length, 1);
  for (const name of ["request", "notification", "disconnected"]) assert.equal(client.listenerCount(name), 0);
});

test("duplicate native ids cannot replace ownership and expired request objects cannot answer reused ids", async () => {
  const { client, agent, calls } = fixture();
  const requests = [];
  agent.on("request", request => requests.push(request));
  const send = sessionId => client.emit("request", { id: 1, method: "item/fileChange/requestApproval", params: { threadId: sessionId, turnId: "turn" } });
  send("owner");
  send("foreign");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sessionId, "owner");
  await agent.respond(requests[0], { decision: "accept" });
  send("owner");
  assert.equal(requests.length, 2);
  await assert.rejects(agent.respond(requests[0], { decision: "accept" }), /失效/);
  await agent.reject(requests[0], "stale rejection");
  assert.equal(calls.length, 1);
  await agent.respond(requests[1], { decision: "decline" });
  assert.deepEqual(calls, [{ id: 1, response: { decision: "accept" } }, { id: 1, response: { decision: "decline" } }]);
});

test("disconnect and terminal close invalidate requests and release native listeners", async () => {
  const { client, agent } = fixture();
  let request;
  agent.on("request", value => { request = value; });
  client.emit("request", { id: 1, method: "item/fileChange/requestApproval", params: { threadId: "session" } });
  client.emit("disconnected", new Error("gone"));
  await assert.rejects(agent.respond(request, { decision: "accept" }), /失效/);
  agent.on("event", () => { throw new Error("consumer failed"); });
  let failure;
  agent.on("disconnected", error => { failure = error; });
  assert.doesNotThrow(() => client.emit("notification", { method: "turn/started", params: { turn: { id: "turn", status: "inProgress" } } }));
  assert.equal(failure.message, "consumer failed");
  await agent.close();
  for (const name of ["request", "notification", "disconnected"]) assert.equal(client.listenerCount(name), 0);
  await assert.rejects(agent.connect(), /关闭/);
});
