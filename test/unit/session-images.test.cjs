const assert = require("node:assert/strict");
const { setImmediate } = require("node:timers/promises");
const { test } = require("node:test");

test("new image drafts upload independently of aborted responses and retain serial uploads within the draft", async t => {
  const { effectScope, ref } = await import("vue");
  const { useSessionImages } = await import("../../web/src/features/session/use-session-images.js");
  const requests = [];
  t.mock.method(globalThis, "fetch", (url, options) => new Promise(resolve => {
    requests.push({ url, options, finish: id => resolve(new Response(JSON.stringify({ id }))) });
  }));
  const scope = effectScope();
  const draft = scope.run(() => useSessionImages({ active: ref("same-session"), canSend: ref(true) }));
  const image = name => new globalThis.File(["fixture"], name, { type: "image/png" });
  try {
    draft.add([image("old.png"), image("discarded.png")]);
    await setImmediate();
    assert.equal(requests.length, 1);
    draft.reset();
    assert.equal(requests[0].options.signal.aborted, true);
    draft.add([image("new.png"), image("next.png")]);
    await setImmediate();
    assert.equal(requests.length, 2, "an old response ignoring abort must not block the new draft");
    assert.equal(requests[1].url, requests[0].url);
    requests[0].finish("stale-id");
    await setImmediate();
    assert.deepEqual(draft.images.value.map(entry => entry.id), ["", ""]);
    assert.equal(requests.length, 2, "uploads inside the new draft remain serialized");
    requests[1].finish("new-id");
    await setImmediate();
    assert.equal(requests.length, 3);
    assert.equal(requests[2].options.body.name, "next.png");
    requests[2].finish("next-id");
    await setImmediate();
    assert.deepEqual(draft.images.value.map(entry => entry.id), ["new-id", "next-id"]);
    assert.equal(draft.blocked.value, false);
  } finally {
    draft.reset();
    scope.stop();
  }
});
