const fs = require('node:fs');
const mode = process.argv[2];
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  prompt += chunk;
});
process.stdin.on('end', () => {
  if (mode === 'timeout') {
    setTimeout(() => {}, 30000);
    return;
  }
  if (mode === 'fail') {
    process.stderr.write('simulated authentication failure');
    process.exitCode = 1;
    return;
  }
  const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  emit({ type: 'thread.started', thread_id: 'session-test-123' });
  if (mode === 'thread-only') return;
  emit({ type: 'turn.started' });
  const file = process.argv[process.argv.indexOf('--output-last-message') + 1];
  fs.writeFileSync(
    file,
    JSON.stringify({
      prompt,
      args: process.argv.slice(3),
      cwd: process.cwd(),
      tapdEnv: process.env.TAPD_TEST_SECRET || null,
    }),
  );
  if (mode === 'turn-fail') {
    emit({ type: 'turn.failed', error: { message: 'simulated turn failure' } });
    process.exitCode = 1;
  } else emit({ type: 'turn.completed' });
});
