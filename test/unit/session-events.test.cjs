const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { SessionEvents } = require("../../src/application/session-events.cjs");

function setup() {
  const preparing = {
    key: "1-2",
    sessionId: undefined,
    status: "preparing",
    items: new Map(),
    requests: new Map(),
  };
  const active = {
    key: "1-3",
    sessionId: "active-thread",
    status: "running",
    items: new Map(),
    requests: new Map(),
  };
  const emitted = [];
  const rejected = [];
  const client = new EventEmitter();
  client.reject = (...args) => rejected.push(args);
  new SessionEvents({
    store: { log() {} },
    client,
    sessions: new Map([[preparing.key, preparing], [active.key, active]]),
    emit: (event) => emitted.push(event),
  });
  return { client, preparing, active, emitted, rejected };
}

test("request resolution without threadId targets its owner while another task is preparing", () => {
  const { client, active, preparing, emitted } = setup();
  active.requests.set("42", { id: "42" });
  client.emit("notification", {
    method: "serverRequest/resolved",
    params: { requestId: 42 },
  });
  assert.equal(active.requests.size, 0);
  assert.equal(preparing.requests.size, 0);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].key, active.key);
  assert.deepEqual(emitted[0].requests, []);
});

test("notifications without a thread identity cannot mutate a preparing task", () => {
  const { client, preparing, emitted } = setup();
  client.emit("notification", {
    method: "item/agentMessage/delta",
    params: { itemId: "foreign-item", delta: "unrelated output" },
  });
  assert.equal(preparing.items.size, 0);
  assert.equal(emitted.length, 0);
});

test("interactive requests without a thread identity are rejected instead of attaching to preparation", () => {
  const { client, preparing, emitted, rejected } = setup();
  client.emit("request", {
    id: 43,
    method: "item/commandExecution/requestApproval",
    params: { command: "echo fixture" },
  });
  assert.equal(preparing.requests.size, 0);
  assert.equal(emitted.length, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0][0], 43);
});
