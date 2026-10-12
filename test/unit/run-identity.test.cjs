const assert = require("node:assert/strict");
const { test } = require("node:test");
const { recordedSources, runKey } = require("../../src/domain/run-identity.cjs");

test("source identities require explicit records and use one channel-neutral key format", () => {
  const source = { channel: "manual", scope: "1", id: "2" };
  assert.deepEqual(recordedSources({ source, workitem: { id: "2", workspace_id: "1" } }), [source]);
  assert.deepEqual(recordedSources({ sources: [source] }), [source]);
  assert.deepEqual(recordedSources({}), []);
  assert.throws(() => recordedSources({ workitem: { id: "2", workspace_id: "1" } }), /source identity/);
  assert.throws(() => runKey(undefined), /source identity/);
  for (const channel of [undefined, null, 1])
    assert.throws(() => runKey({ ...source, channel }), /source identity/);
  assert.throws(() => recordedSources({ sources: { source } }), /source identities/);
  const keys = ["manual", "tracker", "tapd"].map(channel => runKey({ ...source, channel }));
  assert.equal(new Set(keys).size, 3);
  for (const key of keys) assert.match(key, /^[a-z]+-[a-f0-9]{32}$/);
});
