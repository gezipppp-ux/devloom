const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { createWebServer } = require("../../src/http/server.cjs");
const { png } = require("../support/helpers.cjs");

test("aborted binary request releases its connection and later parallel uploads preserve every body", async (t) => {
  const uploaded = [];
  const manager = new EventEmitter();
  manager.channels = { list: () => [] };
  manager.close = async () => {};
  manager.uploadMessageImage = async (key, bytes) => {
    uploaded.push({ key, bytes });
    return { id: `image-${uploaded.length}` };
  };
  const app = createWebServer({ manager, testIdentity: true });
  const origin = await app.listen(0);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(async () => {
    agent.destroy();
    await app.close();
  });
  const { token } = await (await fetch(`${origin}/api/bootstrap`)).json();
  const headers = {
    "x-tapd-token": token,
    "content-type": "image/png",
    "content-length": String(png.length),
  };
  const endpoint = `${origin}/api/runs/1-2/message-images`;
  let sawRequest, sawAbort;
  const arrived = new Promise((resolve) => {
    sawRequest = resolve;
  });
  const aborted = new Promise((resolve) => {
    sawAbort = resolve;
  });
  const observe = (request) => {
    if (request.url !== "/api/runs/1-2/message-images") return;
    app.server.off("request", observe);
    request.once("aborted", sawAbort);
    sawRequest();
  };
  app.server.on("request", observe);
  const partial = http.request(endpoint, { method: "POST", headers, agent });
  partial.on("error", () => {});
  partial.write(png.subarray(0, 16));
  await arrived;
  partial.destroy();
  await aborted;
  assert.equal(
    uploaded.length,
    0,
    "an incomplete body must not reach the upload application service",
  );

  function upload() {
    return new Promise((resolve, reject) => {
      const request = http.request(
        endpoint,
        { method: "POST", headers, agent },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            }),
          );
        },
      );
      request.on("error", reject);
      request.setTimeout(3000, () =>
        request.destroy(
          new Error("upload connection did not become available"),
        ),
      );
      request.end(png);
    });
  }
  const results = await Promise.all(Array.from({ length: 8 }, upload));
  assert.ok(results.every((result) => result.status === 201));
  assert.equal(new Set(results.map((result) => result.body.id)).size, 8);
  assert.equal(uploaded.length, 8);
  for (const item of uploaded) assert.deepEqual(item.bytes, png);

  const stream = await fetch(`${origin}/api/events`);
  const reader = stream.body.getReader();
  await reader.read();
  assert.equal(manager.listenerCount("event"), 1);
  await reader.cancel();
  for (
    let attempt = 0;
    manager.listenerCount("event") && attempt < 50;
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    manager.listenerCount("event"),
    0,
    "a cancelled EventSource releases its subscription",
  );
  assert.equal((await upload()).status, 201);
});
