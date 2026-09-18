const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  validateListenHost,
  requestOrigin,
} = require("../../src/http/origin.cjs");

function request(host, localAddress, headers = {}, port = 4317) {
  return {
    headers: { host, ...headers },
    socket: { localAddress, localPort: port },
  };
}

test("request origins use the connected address and normalize IPv4-mapped IPv6", () => {
  for (const localAddress of ["127.0.0.1", "::ffff:127.0.0.1", "::ffff:7f00:1"])
    assert.equal(
      requestOrigin(request("127.0.0.1:4317", localAddress)),
      "http://127.0.0.1:4317",
    );
  assert.equal(
    requestOrigin(
      request("[::1]:4317", "0:0:0:0:0:0:0:1", {
        origin: "http://[::1]:4317",
      }),
    ),
    "http://[::1]:4317",
  );
  assert.equal(
    requestOrigin(
      request("[::ffff:7f00:1]:4317", "127.0.0.1", {
        origin: "http://[::ffff:7f00:1]:4317",
      }),
    ),
    "http://[::ffff:7f00:1]:4317",
  );
  assert.equal(
    requestOrigin(
      request(
        "192.168.1.2",
        "192.168.1.2",
        { origin: "http://192.168.1.2" },
        80,
      ),
    ),
    "http://192.168.1.2",
  );
});

test("Host and Origin reject foreign authorities and forwarded-header substitutions", () => {
  for (const host of [
    undefined,
    "",
    "evil.test:4317",
    "localhost:4317",
    "127.1:4317",
    "2130706433:4317",
    "0x7f000001:4317",
    "0177.0.0.1:4317",
    "[127.0.0.1]:4317",
    "127.0.0.1:4318",
    "127.0.0.1:4317/path",
    "user@127.0.0.1:4317",
    "0.0.0.0:4317",
    "[fe80::1%eth0]:4317",
  ])
    assert.equal(
      requestOrigin(
        request(host, "127.0.0.1", {
          forwarded: 'host="127.0.0.1:4317"',
          "x-forwarded-host": "127.0.0.1:4317",
        }),
      ),
      null,
      String(host),
    );
  for (const origin of [
    "",
    "null",
    "https://127.0.0.1:4317",
    "http://evil.test:4317",
    "http://127.0.0.1:4318",
  ])
    assert.equal(
      requestOrigin(request("127.0.0.1:4317", "127.0.0.1", { origin })),
      null,
      origin,
    );
  assert.equal(
    requestOrigin(
      request("127.0.0.1:4317", "127.0.0.1", {
        "sec-fetch-site": "cross-site",
      }),
    ),
    null,
  );
});

test("listen hosts require literal IP addresses", () => {
  for (const host of ["127.0.0.1", "0.0.0.0", "::1", "::", "192.168.1.2"])
    assert.equal(validateListenHost(host), host);
  for (const host of [
    undefined,
    "",
    "localhost",
    "example.com",
    "127.1",
    "127.0.0.1:4317",
    "[::1]",
    "fe80::1%eth0",
  ])
    assert.throws(() => validateListenHost(host), /监听地址/);
});
