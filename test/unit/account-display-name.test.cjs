const assert = require("node:assert/strict");
const { test } = require("node:test");
const { displayName, validateAccountCreation, validateAccountUpdate, validateAccountProfile } = require("../../src/domain/account.cjs");

test("display names trim human-readable names independently from login identities", () => {
  assert.equal(displayName("  张三 · 产品  "), "张三 · 产品");
  assert.equal(displayName("😀".repeat(80)), "😀".repeat(80));
  const input = { username: "Alice", password: "password" };
  assert.equal(validateAccountCreation(input, { initial: true }).displayName, "alice");
  assert.equal(validateAccountCreation({ ...input, displayName: " 同名 " }, { initial: true }).displayName, "同名");
  assert.deepEqual(validateAccountUpdate({ displayName: " 名字 " }), { displayName: "名字" });
  assert.deepEqual(validateAccountProfile({ displayName: " 名字 " }), { displayName: "名字" });
});

test("display names reject empty, non-string, long and control-character inputs", () => {
  for (const value of [undefined, null, 42, {}, [], "", "   ", "a".repeat(81), "😀".repeat(81), "a\nb", "\ta", "a\u0000b", "a\u007fb", "a\u0085b", "a\u202eb"]) {
    assert.throws(() => displayName(value), { statusCode: 400 });
    assert.throws(() => validateAccountCreation({ username: "alice", password: "password", displayName: value }, { initial: true }), { statusCode: 400 });
    assert.throws(() => validateAccountUpdate({ displayName: value }), { statusCode: 400 });
    assert.throws(() => validateAccountProfile({ displayName: value }), { statusCode: 400 });
  }
  for (const input of [{}, { displayName: "名字", role: "admin" }, { displayName: "名字", userId: "another" }, { displayName: "名字", username: "other" }])
    assert.throws(() => validateAccountProfile(input), { statusCode: 400 });
});
