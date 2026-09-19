const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { test } = require("node:test");
const { body } = require("../../src/http/messages.cjs");

function request(chunks, contentType = "application/json") {
  const stream = Readable.from(chunks);
  stream.headers = { "content-type": contentType };
  return stream;
}

test("JSON request decoding rejects non-object payloads and unrelated media types", async () => {
  for (const payload of ["null", "[]", '"text"', "true", "42"])
    await assert.rejects(body(request([payload])), /JSON 对象/);
  for (const contentType of [undefined, "text/plain", "application/jsonp", "application/json-invalid"])
    await assert.rejects(body(request(["{}"], contentType || "")), /application\/json/);
  assert.deepEqual(await body(request(["{}"], "Application/JSON; charset=utf-8")), {});
  assert.deepEqual(await body(request([])), {});
  await assert.rejects(body(request(["{"])), SyntaxError);
});

test("JSON request limits count bytes and preserve UTF-8 across chunk boundaries", async () => {
  const payload = { text: "中文指令" };
  const chunks = [...Buffer.from(JSON.stringify(payload))].map((byte) => Buffer.from([byte]));
  assert.deepEqual(await body(request(chunks)), payload);
  const text = JSON.stringify({ text: "中".repeat(90000) });
  assert.ok(text.length < 256000);
  await assert.rejects(body(request([text])), /请求内容过大/);
});
