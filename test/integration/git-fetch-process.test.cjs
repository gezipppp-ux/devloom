const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runFetch } = require("../../src/git/fetch-process.cjs");
const { temporary } = require("../support/helpers.cjs");

function command(t, script) {
  const file = path.join(temporary(t), "fetch-fixture.cjs");
  fs.writeFileSync(file, script);
  const quote = value => "'" + value.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";
  return ["-c", `alias.fetch-fixture=!${quote(process.execPath)} ${quote(file)}`, "fetch-fixture"];
}

test("fetch keeps progressing transfers alive beyond the silence limit", async t => {
  await runFetch(command(t, "process.stderr.write('progress\\r'); const timer=setInterval(()=>process.stderr.write('progress\\r'),100); setTimeout(()=>clearInterval(timer),2200);"), process.env,
    { idleTimeout: 1500, timeout: 10000 });
});

test("fetch bounds both silent and progressing hangs and supports cancellation", async t => {
  await assert.rejects(runFetch(command(t, "setInterval(()=>{},100);"), process.env, { idleTimeout: 500, timeout: 10000 }), /长时间没有响应/);
  await assert.rejects(runFetch(command(t, "setInterval(()=>process.stderr.write('progress\\r'),100);"), process.env,
    { idleTimeout: 5000, timeout: 1200 }), /最长等待时间/);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try { await assert.rejects(runFetch(command(t, "setInterval(()=>{},100);"), process.env, { signal: controller.signal }), /已停止/); }
  finally { clearTimeout(timer); }
  await assert.rejects(runFetch([], process.env, { signal: controller.signal }), /已停止/);
});

test("fetch diagnostics classify missing refs and auth failures without returning remote secrets", async t => {
  for (const [diagnostic, expected] of [["fatal: couldn't find remote ref private-secret", /分支已不存在/], ["Authentication failed for https://private-secret@example.test", /认证被拒绝/]]) {
    await assert.rejects(runFetch(command(t, `process.stderr.write(${JSON.stringify(diagnostic)}); process.exitCode=1;`), process.env), error => {
      assert.match(error.message, expected); assert.ok(!error.message.includes("private-secret")); return true;
    });
  }
});
