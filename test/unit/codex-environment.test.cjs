const assert = require('node:assert/strict');
const { test } = require('node:test');
const { childEnvironment } = require('../../src/codex/environment.cjs');

test('child environments strip alternate-cased TAPD credentials and invoking session identity', () => {
  const original = {
    PATH: '/bin',
    TAPD_COOKIE: 'secret',
    TaPd_TOKEN: 'secret',
    tapd_session: 'secret',
    Codex_Thread_Id: 'parent-task',
    HOME: '/home/runner',
  };
  assert.deepEqual(childEnvironment(original), {
    PATH: '/bin',
    HOME: '/home/runner',
  });
  assert.equal(original.TaPd_TOKEN, 'secret');
  assert.equal(original.Codex_Thread_Id, 'parent-task');
});
