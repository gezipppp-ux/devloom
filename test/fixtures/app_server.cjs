const readline = require('node:readline');
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined || !message.method) return;
  if (message.method === 'fail')
    return send({ id: message.id, error: { message: 'fixture failure' } });
  if (message.method === 'exit') return process.exit(0);
  if (message.method === 'hang') return;
  if (message.method === 'notify')
    send({ method: 'item/agentMessage/delta', params: { delta: '你好' } });
  if (message.method === 'approval')
    send({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'original' },
    });
  setTimeout(
    () =>
      send({
        id: message.id,
        result: { method: message.method, params: message.params },
      }),
    message.params?.delay || 0,
  );
});
