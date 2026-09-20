const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createWebServer } = require("../../src/http/server.cjs");
const { temporary } = require("../support/helpers.cjs");

function fixture(t, host) {
  const directory = temporary(t);
  fs.writeFileSync(path.join(directory, "index.html"), "LAN fixture");
  const writes = [];
  const app = createWebServer({ testIdentity: true,
    host,
    staticDirectory: directory,
    workspaces: {
      list: () => [],
      close: async () => {},
    },
    workspaceClones: {
      start: (input) => {
        writes.push(input);
        return { id: "fixture", ...input };
      },
      close: async () => {},
    },
  });
  t.after(() => app.close());
  return { app, writes };
}

function send(url, { headers, method = "GET", body, requestTarget } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      { method, headers, ...(requestTarget ? { path: requestTarget } : {}) },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    request.setTimeout(5000, () =>
      request.destroy(new Error("Fixture HTTP request timed out")),
    );
    request.on("error", reject);
    request.end(body);
  });
}

test("explicit wildcard bind serves a real LAN address while retaining Host, Origin and token checks", async (t) => {
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry.family === "IPv4" && !entry.internal)?.address;
  if (!address) return t.skip("No non-loopback IPv4 interface is available");
  const { app, writes } = fixture(t, "0.0.0.0");
  const localOrigin = await app.listen(0);
  const { port, address: bound } = app.server.address();
  assert.equal(bound, "0.0.0.0");
  assert.equal(localOrigin, `http://127.0.0.1:${port}`);
  const origin = `http://${address}:${port}`;
  assert.deepEqual(await send(origin), { status: 200, text: "LAN fixture" });
  const bootstrap = await send(`${origin}/api/bootstrap`);
  assert.equal(bootstrap.status, 200);
  const { token } = JSON.parse(bootstrap.text);
  const headers = {
    "content-type": "application/json",
    "x-tapd-token": token,
    origin,
  };
  const payload = JSON.stringify({ name: "局域网测试" });
  assert.equal(
    (
      await send(`${origin}/api/workspaces`, {
        method: "POST",
        headers,
        body: payload,
      })
    ).status,
    202,
  );
  assert.deepEqual(writes, [{ name: "局域网测试" }]);
  for (const invalid of [
    { host: `evil.example:${port}` },
    { host: `127.0.0.1:${port}` },
    { host: `${address}:${port + 1}` },
    { host: `0.0.0.0:${port}` },
    { origin: `http://evil.example:${port}` },
    { origin: localOrigin },
    { "sec-fetch-site": "cross-site" },
    {
      host: `evil.example:${port}`,
      forwarded: `host="${address}:${port}"`,
      "x-forwarded-host": `${address}:${port}`,
    },
  ])
    assert.equal(
      (await send(`${origin}/api/bootstrap`, { headers: invalid })).status,
      403,
      JSON.stringify(invalid),
    );
  for (const value of [undefined, "wrong-token"]) {
    const invalid = { ...headers };
    if (value === undefined) delete invalid["x-tapd-token"];
    else invalid["x-tapd-token"] = value;
    assert.equal(
      (
        await send(`${origin}/api/workspaces`, {
          method: "POST",
          headers: invalid,
          body: payload,
        })
      ).status,
      403,
    );
  }
  assert.equal(writes.length, 1);
  for (const requestTarget of [
    "http://evil.example/api/bootstrap",
    "//evil.example/api/bootstrap",
  ])
    assert.equal((await send(origin, { requestTarget })).status, 403);
  assert.equal((await send(`${localOrigin}/api/bootstrap`)).status, 200);
  assert.equal(
    (
      await send(`${origin}/api/bootstrap`, {
        headers: {
          forwarded: "host=evil.example",
          "x-forwarded-host": "evil.example",
        },
      })
    ).status,
    200,
  );
});

test("an explicit IPv6 loopback bind uses a bracketed same-origin address", async (t) => {
  const { app } = fixture(t, "::1");
  let origin;
  try {
    origin = await app.listen(0);
  } catch (error) {
    if (["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code))
      return t.skip("IPv6 loopback is unavailable");
    throw error;
  }
  assert.match(origin, /^http:\/\/\[::1\]:\d+$/);
  assert.equal((await send(origin, { headers: { origin } })).status, 200);
  assert.equal(
    (
      await send(origin, {
        headers: { host: `evil.example:${app.server.address().port}` },
      })
    ).status,
    403,
  );
});
