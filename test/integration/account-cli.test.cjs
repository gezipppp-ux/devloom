const assert = require("node:assert/strict");
const { Readable, Writable } = require("node:stream");
const { test } = require("node:test");
const { main } = require("../../src/cli/init-admin.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { verifyPassword } = require("../../src/storage/account-passwords.cjs");
const { temporary } = require("../support/helpers.cjs");

test("local admin CLI initializes without printing or accepting arguments", async (t) => {
  const directory = temporary(t);
  const seeded = await initializeTestDatabase(t, directory);
  let text = "";
  const output = new Writable({
    write(chunk, _encoding, next) {
      text += chunk.toString();
      next();
    },
  });
  const password = "local6";
  const run = (value) =>
    main([], {
      directory,
      databaseUrl: seeded.testUrl,
      output,
      input: Readable.from([`${value}\n${value}\n`]),
    });
  await assert.rejects(run("abc12"), /6–256/);
  await run(password);
  await assert.rejects(run(password), /已初始化/);
  const database = await initializeTestDatabase(t, directory);
  try {
    const row = await database.client.user.findUniqueOrThrow({ where: { username: "admin" } });
    assert.equal(row.role, "admin");
    assert.equal(row.mustChangePassword, false);
    assert.equal(await verifyPassword(password, row.passwordHash), true);
    assert.equal(
      await database.client.auditEvent.count({ where: { event: "account.local.init" } }),
      1,
    );
  } finally {
    await database.close();
  }
  assert.doesNotMatch(
    text,
    /local6|scrypt/,
  );
  await assert.rejects(
    main(["--password", password], {
      directory,
      databaseUrl: seeded.testUrl,
      output,
    }),
    /不接受/,
  );
});

test("piped account passwords preserve UTF-8 when multibyte characters span input chunks", async (t) => {
  const directory = temporary(t);
  const seeded = await initializeTestDatabase(t, directory);
  const password = "中文密码与边界验证-fixture";
  const input = Readable.from([...Buffer.from(`${password}\n${password}\n`)]
    .map((byte) => Buffer.from([byte])));
  await main([], {
    directory,
      databaseUrl: seeded.testUrl,
    input,
    output: new Writable({ write(_chunk, _encoding, next) { next(); } }),
  });
  const database = await initializeTestDatabase(t, directory);
  try {
    const row = await database.client.user.findUniqueOrThrow({ where: { username: "admin" } });
    assert.equal(await verifyPassword(password, row.passwordHash), true);
  } finally {
    await database.close();
  }
});
