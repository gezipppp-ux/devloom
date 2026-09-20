const assert = require("node:assert/strict");
const { Readable, Writable } = require("node:stream");
const { test } = require("node:test");
const { main } = require("../../src/cli/accounts.cjs");
const {
  initializeDatabase,
} = require("../../src/storage/database-lifecycle.cjs");
const { verifyPassword } = require("../../src/storage/account-passwords.cjs");
const { temporary } = require("../support/helpers.cjs");

test("local account CLI initializes and resets without printing or accepting password arguments", async (t) => {
  const directory = temporary(t);
  let text = "";
  const output = new Writable({
    write(chunk, _encoding, next) {
      text += chunk.toString();
      next();
    },
  });
  const first = "local6",
    second = "reset6";
  const run = (action, password) =>
    main([action, "--username", "admin"], {
      directory,
      output,
      input: Readable.from([`${password}\n${password}\n`]),
    });
  await assert.rejects(run("init", "abc12"), /6–256/);
  await run("init", first);
  await assert.rejects(run("init", first), /已初始化/);
  await assert.rejects(run("reset", "abc12"), /6–256/);
  await run("reset", second);
  const database = await initializeDatabase(directory);
  try {
    const row = database.handle
      .prepare("SELECT * FROM users WHERE username='admin'")
      .get();
    assert.equal(row.role, "admin");
    assert.equal(row.must_change_password, 1);
    assert.equal(await verifyPassword(second, row.password_hash), true);
    assert.equal(
      database.handle
        .prepare(
          "SELECT count(*) AS count FROM audit_events WHERE event LIKE 'account.local.%'",
        )
        .get().count,
      2,
    );
  } finally {
    database.close();
  }
  assert.doesNotMatch(
    text,
    /local6|reset6|scrypt/,
  );
  await assert.rejects(
    main(["init", "--username", "admin", "--password", first], {
      directory,
      output,
    }),
    /用法/,
  );
});

test("piped account passwords preserve UTF-8 when multibyte characters span input chunks", async (t) => {
  const directory = temporary(t);
  const password = "中文密码与边界验证-fixture";
  const input = Readable.from([...Buffer.from(`${password}\n${password}\n`)]
    .map((byte) => Buffer.from([byte])));
  await main(["init", "--username", "admin"], {
    directory,
    input,
    output: new Writable({ write(_chunk, _encoding, next) { next(); } }),
  });
  const database = await initializeDatabase(directory);
  try {
    const row = database.handle.prepare("SELECT password_hash FROM users WHERE username='admin'").get();
    assert.equal(await verifyPassword(password, row.password_hash), true);
  } finally {
    database.close();
  }
});
