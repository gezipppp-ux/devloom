const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { setImmediate } = require("node:timers");
const { test } = require("node:test");
const { SessionEvents } = require("../../src/application/session-events.cjs");

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// All fake storage operations complete in microtasks. An event-loop checkpoint
// detects dependency on an unreleased gate without a timing-based sleep.
async function completesBeforeCheckpoint(promise, message) {
  const completed = await Promise.race([
    promise.then(() => true),
    new Promise(resolve => setImmediate(() => resolve(false))),
  ]);
  assert.equal(completed, true, message);
}

function setup(t) {
  const runtime = key => ({
    key, sessionId: `session-${key}`, turnId: `turn-${key}`,
    status: "running", connected: true, error: null,
    items: new Map(), requests: new Map(), completedTurns: new Set(),
  });
  const a = runtime("run-a"), b = runtime("run-b");
  const historyEntered = deferred(), historyGate = deferred();
  const emitted = [], interrupted = [], saved = [], finals = [];
  const agent = new EventEmitter();
  agent.capabilities = { approvals: true, userInput: true };
  agent.reject = async () => {};
  agent.interruptTurn = async target => { interrupted.push(target); };
  const store = {
    // Select the database-backed history path without opening any database.
    database: {},
    log: async () => {},
    recordNotification: async () => {},
    saveHistoryItem: async (key, item) => { saved.push({ key, item: structuredClone(item) }); },
    update: async () => {},
    readWeb: async () => ({}),
    writeWeb: async () => {},
    writeFinal: async (key, text) => { finals.push({ key, text }); },
  };
  const events = new SessionEvents({
    store, agent, sessions: new Map([[a.key, a], [b.key, b]]),
    emit: event => emitted.push(structuredClone(event)),
    synchronizeHistory: async key => {
      if (key === a.key) {
        historyEntered.resolve();
        await historyGate.promise;
      }
    },
  });
  t.after(async () => {
    historyGate.resolve();
    await events.drain();
    await Promise.all([events.settle(a.key), events.settle(b.key)]);
  });
  const complete = entry => agent.emit("event", {
    type: "turn-completed", sessionId: entry.sessionId,
    turn: { id: entry.turnId, status: "completed" },
  });
  const approval = entry => ({
    id: `approval-${entry.key}`, sessionId: entry.sessionId, turnId: entry.turnId,
    kind: "approval", action: "command", blocking: true, command: "echo fixture",
  });
  return { events, agent, store, a, b, historyEntered, historyGate,
    emitted, interrupted, saved, finals, complete, approval };
}

test("another session processes approval, streamed output and completion while history is suspended", async t => {
  const fixture = setup(t);
  const { events, agent, a, b, historyEntered, emitted, saved, finals, complete, approval } = fixture;
  complete(a);
  await historyEntered.promise;

  agent.emit("request", approval(b));
  agent.emit("event", {
    type: "item-delta", sessionId: b.sessionId, turnId: b.turnId,
    itemId: "answer-b", field: "text", delta: "B finished independently",
  });
  complete(b);
  await completesBeforeCheckpoint(events.drain(b.key), "B events must not wait for A history");

  const bEvents = emitted.filter(event => event.key === b.key);
  assert.deepEqual(bEvents.map(event => event.type), ["requests", "item", "state"]);
  assert.equal(bEvents[0].requests[0].id, `approval-${b.key}`);
  assert.equal(bEvents[1].item.text, "B finished independently");
  assert.equal(bEvents[2].status, "completed");
  assert.equal(b.turnId, null);
  assert.equal(b.requests.size, 0);
  assert.equal(saved.some(entry => entry.key === b.key && entry.item.status === "completed"), true);
  assert.deepEqual(finals, [{ key: b.key, text: "B finished independently" }]);
});

test("session drain and settle remain independent while global drain waits for suspended history", async t => {
  const { events, a, b, historyEntered, historyGate, complete } = setup(t);
  complete(a);
  await historyEntered.promise;
  let globallyDrained = false;
  const globalDrain = events.drain().then(() => { globallyDrained = true; });

  await completesBeforeCheckpoint(events.drain(b.key), "drain(B) must ignore A's pending history");
  await completesBeforeCheckpoint(events.settle(b.key), "settle(B) must ignore A's pending history");
  assert.equal(globallyDrained, false, "shutdown's global drain must still wait for A");

  historyGate.resolve();
  await globalDrain;
  assert.equal(globallyDrained, true);
});

test("events for the same session stay ordered behind its suspended history", async t => {
  const { events, agent, a, b, historyEntered, historyGate, emitted, complete } = setup(t);
  complete(a);
  await historyEntered.promise;
  agent.emit("event", {
    type: "item", sessionId: a.sessionId, turnId: "turn-a",
    item: { id: "late-a", type: "agentMessage", text: "late A output", status: "completed" },
  });
  await completesBeforeCheckpoint(events.drain(b.key), "unrelated session must remain drainable");
  assert.equal(a.items.has("late-a"), false);

  historyGate.resolve();
  await events.drain();
  assert.equal(a.items.get("late-a").text, "late A output");
  assert.deepEqual(emitted.filter(event => event.key === a.key).map(event => event.type), ["state", "item"]);
});

test("a queued request persistence failure only fails and interrupts its owning session", async t => {
  const { events, agent, store, a, b, emitted, interrupted, approval } = setup(t);
  store.log = async key => {
    if (key === a.key) throw new Error("A request persistence failed");
  };
  agent.emit("request", approval(a));
  agent.emit("request", approval(b));
  agent.emit("event", {
    type: "item", sessionId: b.sessionId, turnId: b.turnId,
    item: { id: "healthy-b", type: "agentMessage", text: "B remains healthy", status: "completed" },
  });
  await events.drain();

  assert.equal(a.error, "A request persistence failed");
  assert.equal(b.error, null);
  assert.equal(b.status, "running");
  assert.equal(b.requests.has(`approval-${b.key}`), true);
  assert.equal(b.items.get("healthy-b").text, "B remains healthy");
  assert.deepEqual(interrupted, [{ sessionId: a.sessionId, turnId: a.turnId }]);
  assert.deepEqual(emitted.filter(event => event.type === "error").map(event => event.key), [a.key]);
});

test("resolution without sessionId follows its queued request before that request reaches runtime", async t => {
  const { events, agent, store, a, b, emitted, approval } = setup(t);
  const entered = deferred(), gate = deferred();
  store.recordNotification = async (key, event) => {
    if (key === a.key && event.item?.id === "blocked-a") {
      entered.resolve();
      await gate.promise;
    }
  };
  agent.emit("event", {
    type: "item", sessionId: a.sessionId, turnId: a.turnId,
    item: { id: "blocked-a", type: "agentMessage", text: "A output", status: "completed" },
  });
  try {
    await entered.promise;
    const request = approval(a);
    agent.emit("request", request);
    agent.emit("event", { type: "request-resolved", requestId: request.id });
    await completesBeforeCheckpoint(events.drain(b.key), "B must not wait for A's queued interaction");
    assert.equal(a.requests.size, 0, "the request is still queued behind A's output");

    gate.resolve();
    await events.drain();
    assert.equal(a.requests.size, 0, "the queued request must not survive its resolution");
    assert.deepEqual(emitted.filter(event => event.key === a.key && event.type === "requests")
      .map(event => event.requests.map(entry => entry.id)), [[request.id], []]);
    assert.equal(b.requests.size, 0);
  } finally {
    gate.resolve();
    await events.drain();
  }
});

test("queued items cannot enter a replacement runtime reusing the same run and session identifiers", async t => {
  const { events, agent, store, a, emitted, saved } = setup(t);
  const entered = deferred(), gate = deferred();
  store.recordNotification = async (key, event) => {
    if (key === a.key && event.item?.id === "before-replacement") {
      entered.resolve();
      await gate.promise;
    }
  };
  agent.emit("event", {
    type: "item", sessionId: a.sessionId, turnId: a.turnId,
    item: { id: "before-replacement", type: "agentMessage", text: "old output", status: "completed" },
  });
  try {
    await entered.promise;
    agent.emit("event", {
      type: "item", sessionId: a.sessionId, turnId: a.turnId,
      item: { id: "queued-old-item", type: "agentMessage", text: "stale output", status: "completed" },
    });
    const replacement = {
      ...a, items: new Map(), requests: new Map(), completedTurns: new Set(),
    };
    events.sessions.set(a.key, replacement);
    gate.resolve();
    await events.drain(a.key);

    assert.equal(replacement.items.size, 0);
    assert.equal(a.items.has("queued-old-item"), false);
    assert.equal(saved.some(entry => entry.item.id === "queued-old-item"), false);
    assert.equal(emitted.some(event => event.item?.id === "queued-old-item"), false);
    assert.equal(events.sessions.get(a.key), replacement);
  } finally {
    gate.resolve();
    await events.drain();
  }
});
