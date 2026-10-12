const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { test } = require('node:test');
const { temporary } = require('../support/helpers.cjs');
const { RunStore } = require('../../src/storage/run-store.cjs');
const { writeConfig, updateConfig, readOptional } = require('../../src/storage/json-files.cjs');
const { saveSession } = require('../../src/channels/tapd/auth-utils.cjs');

test('concurrent task metadata updates preserve the other process field', { timeout: 15000 }, async (t) => {
  const directory = temporary(t);
  const store = new RunStore(directory);
  (await store.writeTaskMetadata('1-2', { type: 'requirement', progress: 'in_progress' }));
  const gate = new SharedArrayBuffer(4);
  const workers = [];
  t.after(async () => { await Promise.all(workers.map((worker) => worker.terminate())); });
  function writer(role) {
    const worker = new Worker(`
      const fs = require('node:fs');
      const path = require('node:path');
      const { workerData, parentPort } = require('node:worker_threads');
      const { RunStore } = require(workerData.storeModule);
      const store = new RunStore(workerData.directory);
      const file = path.join(store.dir('1-2'), 'task-metadata.json');
      const read = fs.readFileSync;
      const mkdir = fs.mkdirSync;
      let signalled = false;
      if (workerData.role === 'first') fs.readFileSync = function(target, ...args) {
        const data = read.call(this, target, ...args);
        if (target === file && !signalled) {
          signalled = true;
          parentPort.postMessage('paused');
          if (Atomics.wait(new Int32Array(workerData.gate), 0, 0, 5000) === 'timed-out')
            throw new Error('Metadata writer barrier timed out');
        }
        return data;
      };
      else fs.mkdirSync = function(target, ...args) {
        try { return mkdir.call(this, target, ...args); }
        catch (error) {
          if (target === file + '.lock' && error.code === 'EEXIST' && !signalled) {
            signalled = true;
            parentPort.postMessage('contended');
          }
          throw error;
        }
      };
      store.writeTaskMetadata('1-2', workerData.role === 'first' ? {type:'bug'} : {progress:'done'});
      parentPort.postMessage('done');
    `, { eval: true, workerData: { directory, gate, role, storeModule: require.resolve('../../src/storage/run-store.cjs') } });
    workers.push(worker);
    const milestone = new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    const finished = new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`)));
    });
    finished.catch(() => {});
    return { milestone, finished };
  }
  const first = writer('first');
  assert.equal(await first.milestone, 'paused');
  const second = writer('second');
  try {
    await second.milestone;
  } finally {
    Atomics.store(new Int32Array(gate), 0, 1);
    Atomics.notify(new Int32Array(gate), 0);
  }
  await Promise.all([first.finished, second.finished]);
  assert.deepEqual((await store.readTaskMetadata('1-2')), { type: 'bug', progress: 'done' });
  assert.deepEqual(fs.readdirSync(store.dir('1-2')), ['task-metadata.json']);
});

test('authentication refresh keeps workspace version and atomically preserves the previous config on write failure', async (t) => {
  const directory = temporary(t);
  const file = path.join(directory, 'config.json');
  const previous = {
    version: 3, workspace: { id: 'workspace-fixture', name: '项目名称' },
    agent: { provider: 'codex' }, execution: { repository: '/recorded/repository' },
    workflow: { allow_write: true, fields: { developer: 'fixture' } },
    tapd: { image_hosts: ['images.example.invalid'], session: { cookie_header: 'old-fixture' } },
  };
  (await writeConfig(file, previous));
  const session = { cookie_header: 'new-fixture', request_body: {} };
  (await saveSession(session, file));
  const expected = { ...previous, tapd: { ...previous.tapd, session } };
  assert.deepEqual((await readOptional(file)), expected);
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', function (source, target) {
    if (target === file) throw new Error('fixture rename failed');
    return rename.call(this, source, target);
  });
  (await assert.rejects(async () => (await saveSession({ cookie_header: 'failed-fixture' }, file)), /fixture rename failed/));
  assert.deepEqual((await readOptional(file)), expected);
  assert.deepEqual(fs.readdirSync(directory), ['config.json']);
});

test('JSON updates release their lock when validation fails and preserve independently owned configuration fields', async (t) => {
  const directory = temporary(t);
  const file = path.join(directory, 'config.json');
  (await writeConfig(file, { workspace: { id: 'fixture' }, tapd: { session: { cookie_header: 'fixture' } } }));
  (await assert.rejects(async () => (await updateConfig(file, () => { throw new Error('invalid draft'); })), /invalid draft/));
  const saved = (await updateConfig(file, (current) => ({ ...current, agent: { provider: 'codex' }, execution: { repository: '/new/repository' } })));
  assert.deepEqual(saved.workspace, { id: 'fixture' });
  assert.equal(saved.tapd.session.cookie_header, 'fixture');
  assert.deepEqual(fs.readdirSync(directory), ['config.json']);
});
