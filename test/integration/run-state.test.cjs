const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { saveState } = require('../../src/storage/run-state.cjs');
const { temporary } = require('../support/helpers.cjs');

test('concurrent state writers preserve independently owned fields', async (t) => {
  const directory = temporary(t);
  const file = path.join(directory, 'run.json');
  const stateModule = require.resolve('../../src/storage/run-state.cjs');
  saveState(file, { session_id: 'original', worktree: { path: 'recorded' } });
  const barrier = new SharedArrayBuffer(4);
  const workers = Array.from(
    { length: 3 },
    (_, index) =>
      new Worker(
        `
    const { workerData } = require('node:worker_threads');
    const { updateState } = require(workerData.stateModule);
    const barrier = new Int32Array(workerData.barrier);
    Atomics.add(barrier, 0, 1);
    while (Atomics.load(barrier, 0) < 3) Atomics.wait(barrier, 0, Atomics.load(barrier, 0), 10);
    for (let value = 0; value < 60; value++)
      updateState(workerData.file, { [workerData.field]: value });
  `,
        {
          eval: true,
          workerData: { file, stateModule, barrier, field: `field${index}` },
        },
      ),
  );
  t.after(async () => {
    await Promise.all(workers.map((worker) => worker.terminate()));
  });
  await Promise.all(
    workers.map(
      (worker) =>
        new Promise((resolve, reject) => {
          worker.once('error', reject);
          worker.once('exit', (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`Worker exited: ${code}`)),
          );
        }),
    ),
  );
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(!Number.isNaN(Date.parse(saved.updated_at)));
  assert.deepEqual(saved, {
    session_id: 'original',
    worktree: { path: 'recorded' },
    updated_at: saved.updated_at,
    field0: 59,
    field1: 59,
    field2: 59,
  });
  assert.deepEqual(fs.readdirSync(directory), ['run.json']);
});
