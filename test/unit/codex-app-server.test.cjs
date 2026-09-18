const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { AppServer } = require('../../src/codex/app-server.cjs');
const { temporary } = require('../support/helpers.cjs');

test('explicit shutdown is terminal and cannot launch another transport', async () => {
  const client = new AppServer({ command: process.execPath });
  client.close();
  client.open = () => assert.fail('closed transport must not spawn');
  await assert.rejects(client.connect(), /服务已关闭/);
  assert.throws(() => client.inspectExecutionCapabilities(), /服务已关闭/);
});

test('failed initialization cannot close a replacement connection started by disconnect listeners', async (t) => {
  const directory = temporary(t);
  const failed = path.join(directory, '失败 连接.cjs');
  const ready = path.join(directory, '可用 连接.cjs');
  fs.writeFileSync(
    failed,
    'process.stdin.resume(); process.stdin.once("data", () => process.exit(1));',
  );
  fs.writeFileSync(
    ready,
    `
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const message=JSON.parse(line);
      process.stdout.write('null\\n42\\n"startup log"\\n[]\\n');
      if(message.id) process.stdout.write(JSON.stringify({id:message.id,result:{ok:true}})+'\\n');
    });
  `,
  );
  const client = new AppServer({
    command: process.execPath,
    command_args: [failed],
  });
  t.after(() => client.close());
  let replacement;
  client.once('disconnected', () => {
    client.config.command_args = [ready];
    replacement = client.connect();
  });
  await assert.rejects(client.connect(), /连接已关闭/);
  await replacement;
  assert.deepEqual(await client.request('probe', {}, 1000), { ok: true });
});

test('closed stdout rejects pending RPC promptly even when the process remains alive', async (t) => {
  const directory = temporary(t);
  const script = path.join(directory, '关闭 输出.cjs');
  fs.writeFileSync(
    script,
    `
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const message=JSON.parse(line);
      if(message.method==='initialize') process.stdout.write(JSON.stringify({id:message.id,result:{}})+'\\n');
    });
    setInterval(()=>{},1000);
  `,
  );
  const client = new AppServer({
    command: process.execPath,
    command_args: [script],
  });
  t.after(() => client.close());
  await client.connect();
  const child = client.child;
  let childClosed = false;
  child.once('close', () => {
    childClosed = true;
  });
  const pending = client.request('pending', {}, 1000);
  child.stdout.destroy();
  await assert.rejects(pending, /输出连接已关闭/);
  await client.close();
  assert.equal(
    childClosed,
    true,
    'shutdown must await the disconnected process cleanup',
  );
  assert.equal(client.child, null);
});
