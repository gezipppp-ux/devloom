const test = require("node:test");
const assert = require("node:assert/strict");
const { AsyncLocalStorage } = require("node:async_hooks");
const { PostgresDatabase } = require("../../src/storage/postgres-database.cjs");

test("commit conflicts use the same storage error code as query conflicts without retrying operations", async () => {
  const conflict = Object.assign(new Error("TransactionWriteConflict"), { name: "DriverAdapterError", cause: { kind: "TransactionWriteConflict" } });
  const database = Object.assign(Object.create(PostgresDatabase.prototype), { ready: true, context: new AsyncLocalStorage() });
  let commits = 0, operations = 0;
  database.baseClient = { async $transaction(operation) { await operation({}); commits++; throw conflict; } };
  await assert.rejects(database.transaction(async () => { operations++; }), { code: "P2034", cause: conflict });
  assert.equal(operations, 1);
  assert.equal(commits, 1);
  const unrelated = Object.assign(new Error("connection lost"), { name: "DriverAdapterError", cause: { kind: "ConnectionClosed" } });
  database.baseClient.$transaction = async () => { throw unrelated; };
  await assert.rejects(database.transaction(async () => {}), error => error === unrelated);
});
