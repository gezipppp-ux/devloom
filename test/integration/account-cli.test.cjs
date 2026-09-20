const assert = require("node:assert/strict");
const { Readable, Writable } = require("node:stream");
const { test } = require("node:test");
const { main } = require("../../src/cli/init-admin.cjs");
const {
  initializeDatabase,
} = require("../../src/storage/database-lifecycle.cjs");
const { verifyPassword } = require("../../src/storage/account-passwords.cjs");
const { temporary } = require("../support/helpers.cjs");

test("local admin CLI initializes without printing or accepting arguments", async (t) => {
  const directory = temporary(t);
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
      output,
      input: Readable.from([`${value}\n${value}\n`]),
    });
  await assert.rejects(run("abc12"), /6–256/);
  await run(password);
  await assert.rejects(run(password), /已初始化/);
  const database = await initializeDatabase(directory);
  try {
    const row = database.handle
      .prepare("SELECT * FROM users WHERE username='admin'")
      .get();
    assert.equal(row.role, "admin");
    assert.equal(row.must_change_password, 0);
    assert.equal(await verifyPassword(password, row.password_hash), true);
    assert.equal(
      database.handle
        .prepare(
          "SELECT count(*) AS count FROM audit_events WHERE event = 'account.local.init'",
        )
        .get().count,
      1,
    );
  } finally {
    database.close();
  }
  assert.doesNotMatch(
    text,
    /local6|scrypt/,
  );
  await assert.rejects(
    main(["--password", password], {
      directory,
      output,
    }),
    /不接受/,
  );
});

test("piped account passwords preserve UTF-8 when multibyte characters span input chunks", async (t) => {
  const directory = temporary(t);
  const password = "中文密码与边界验证-fixture";
  const input = Readable.from([...Buffer.from(`${password}\n${password}\n`)]
    .map((byte) => Buffer.from([byte])));
  await main([], {
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
