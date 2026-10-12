const test = require("node:test");
const assert = require("node:assert/strict");
const { assetInput } = require("../../src/domain/project-assets.cjs");

test("assets reject production environments, unsafe links and misplaced sensitive values", () => {
  const asset = assetInput({ title: "测试账号", type: "credential", secret: "  preserve secret  ", environment: "test" });
  assert.equal(asset.secret, "  preserve secret  ");
  assert.throws(() => assetInput({ title: "账号", environment: "production" }), /非生产/);
  assert.throws(() => assetInput({ title: "文档", secret: "value" }), /敏感值/);
  assert.throws(() => assetInput({ title: "链接", url: "javascript:alert(1)" }), /HTTP/);
  assert.throws(() => assetInput({ title: "链接", url: "https://username:password@example.com" }), /凭据/);
  assert.throws(() => assetInput({ title: "备注", issueIds: ["a", "a"] }), /不同标识/);
});

test("asset edits distinguish omission, explicit secret clearing and stale revisions", () => {
  const current = { type: "token", secret: "ciphertext" };
  assert.equal(Object.hasOwn(assetInput({ revision: 1, title: "改名" }, current), "secret"), false);
  assert.equal(assetInput({ revision: 1, secret: null }, current).secret, null);
  assert.throws(() => assetInput({ revision: 1, type: "note" }, current), /敏感值/);
  assert.throws(() => assetInput({ title: "未带修订号" }, current), /修订号/);
});
