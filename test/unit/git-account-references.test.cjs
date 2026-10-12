const assert = require("node:assert/strict");
const { test } = require("node:test");
const { GitAccountStore } = require("../../src/storage/git-account-store.cjs");

test("Git account references follow workspace execution settings and stay owner scoped", async () => {
  const calls = [];
  const store = new GitAccountStore({ encryptionKey: Buffer.alloc(32), client: {
    developmentSpace: { count: async input => { calls.push(input); return 0; } },
    workspaceSetting: { count: async input => { calls.push(input); return 1; } },
  } });
  assert.equal(await store.isReferenced("account", "owner"), true);
  assert.deepEqual(calls, [
    { where: { gitAccountId: "account", userId: "owner" } },
    { where: { workspace: { ownerUserId: "owner" }, data: { path: ["execution", "gitAccountId"], equals: "account" } } },
  ]);
});
