const assert = require("node:assert/strict");
const { test } = require("node:test");
const { publicOrigin, requestOrigin } = require("../../src/http/origin.cjs");

test("HTTPS proxy origin requires explicit origin and a local TLS-terminating proxy", () => {
  const origin = publicOrigin("https://console.example.test");
  const request = {
    headers: {
      host: "console.example.test",
      origin,
      "x-forwarded-proto": "https",
    },
    socket: {
      remoteAddress: "127.0.0.1",
      localAddress: "127.0.0.1",
      localPort: 4317,
    },
  };
  assert.equal(requestOrigin(request, origin), origin);
  assert.equal(
    requestOrigin(
      { ...request, socket: { ...request.socket, remoteAddress: "10.0.0.5" } },
      origin,
    ),
    null,
  );
  for (const headers of [
    { host: "evil.example.test" },
    { origin: "https://evil.example.test" },
    { "x-forwarded-proto": "http" },
    { "sec-fetch-site": "cross-site" },
  ])
    assert.equal(
      requestOrigin(
        { ...request, headers: { ...request.headers, ...headers } },
        origin,
      ),
      null,
    );
  for (const value of [
    "http://console.example.test",
    "https://console.example.test/path",
    "https://user:pass@console.example.test",
  ])
    assert.throws(() => publicOrigin(value), /PUBLIC_ORIGIN/);
});
