const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { createEventStream } = require("../../src/http/events.cjs");
const { createWebServer } = require("../../src/http/server.cjs");

function connection() {
  const request = new EventEmitter();
  const response = new EventEmitter();
  response.writableLength = 0;
  response.frames = [];
  response.writeHead = () => {};
  response.write = (frame) => response.frames.push(frame);
  response.end = () => response.emit("close");
  response.destroy = () => response.emit("close");
  return { request, response };
}

test("event transport isolates workspaces and releases subscriptions on shutdown", (t) => {
  const stream = createEventStream();
  t.after(() => stream.close());
  const first = new EventEmitter();
  const second = new EventEmitter();
  const a = connection();
  const b = connection();
  const sibling = connection();
  stream.connect(a.request, a.response, first);
  stream.connect(b.request, b.response, second);
  stream.connect(sibling.request, sibling.response, first);
  assert.equal(first.listenerCount("event"), 1);
  first.emit("event", { key: "first", type: "state" });
  assert.equal(a.response.frames.length, 2);
  assert.equal(sibling.response.frames.length, 2);
  assert.equal(b.response.frames.length, 1);
  a.request.emit("close");
  first.emit("event", { key: "first", type: "state" });
  assert.equal(a.response.frames.length, 2);
  assert.equal(sibling.response.frames.length, 3);
  sibling.response.writableLength = 1024 * 1024 + 1;
  first.emit("event", { key: "first", type: "state" });
  first.emit("event", { key: "first", type: "state" });
  assert.equal(sibling.response.frames.length, 3);
  stream.close();
  assert.equal(first.listenerCount("event"), 0);
  assert.equal(second.listenerCount("event"), 0);
  second.emit("event", { key: "second", type: "state" });
  assert.equal(b.response.frames.length, 1);
});

test("server shutdown rejects SSE reconnections while session shutdown is pending", async (t) => {
  const manager = new EventEmitter();
  const closing = Promise.withResolvers();
  const release = Promise.withResolvers();
  let closeCalls = 0;
  manager.close = async () => {
    closeCalls++;
    closing.resolve();
    await release.promise;
  };
  const app = createWebServer({
    manager,
    channels: {},
    workspaces: { close: async () => {} },
  });
  const origin = await app.listen(0);
  t.after(async () => {
    release.resolve();
    await app.close();
  });
  const stream = await fetch(`${origin}/api/events`);
  const reader = stream.body.getReader();
  await reader.read();
  assert.equal(manager.listenerCount("event"), 1);
  const shutdown = app.close();
  await closing.promise;
  assert.equal(manager.listenerCount("event"), 0);
  const attempt = await fetch(`${origin}/api/events`, {
    signal: AbortSignal.timeout(1000),
  }).then(
    (response) => {
      response.body?.cancel();
      return response.status;
    },
    () => "refused",
  );
  assert.ok(attempt === "refused" || attempt === 503);
  release.resolve();
  await shutdown;
  assert.equal((await reader.read()).done, true);
  await app.close();
  assert.equal(closeCalls, 1);
});
