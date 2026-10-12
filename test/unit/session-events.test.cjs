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
  const agent = new EventEmitter();
  agent.reject = (...args) => rejected.push(args);
  const events = new SessionEvents({
    store: { log() {} },
    agent,
    sessions: new Map([[preparing.key, preparing], [active.key, active]]),
    emit: (event) => emitted.push(event),
  });
  return { events, agent, preparing, active, emitted, rejected };
}

test("request resolution without sessionId targets its owner while another task is preparing", async () => {
  const { events, agent, active, preparing, emitted } = setup();
  active.requests.set("42", { id: "42" });
  agent.emit("event", {
    type: "request-resolved",
    requestId: "42",
  });
  await events.drain();
  assert.equal(active.requests.size, 0);
  await events.drain();
  assert.equal(preparing.requests.size, 0);
  await events.drain();
  assert.equal(emitted.length, 1);
  await events.drain();
  assert.equal(emitted[0].key, active.key);
  assert.deepEqual(emitted[0].requests, []);
});

test("notifications without a session identity cannot mutate a preparing task", async () => {
  const { events, agent, preparing, emitted } = setup();
  agent.emit("event", {
    type: "item-delta",
    itemId: "foreign-item", field: "text", delta: "unrelated output",
  });
  await events.drain();
  assert.equal(preparing.items.size, 0);
  await events.drain();
  assert.equal(emitted.length, 0);
});

test("interactive requests without a session identity are rejected instead of attaching to preparation", async () => {
  const { events, agent, preparing, emitted, rejected } = setup();
  agent.emit("request", {
    id: "request-43", kind: "approval", blocking: true,
    command: "echo fixture",
  });
  await events.drain();
  assert.equal(preparing.requests.size, 0);
  await events.drain();
  assert.equal(emitted.length, 0);
  await events.drain();
  assert.equal(rejected.length, 1);
  await events.drain();
  assert.equal(rejected[0][0].id, "request-43");
});
