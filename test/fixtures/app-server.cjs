const readline = require('node:readline');
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let experimentalApi = false;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined || !message.method) return;
  if (message.method === 'initialize') experimentalApi = message.params.capabilities?.experimentalApi === true;
  if (message.method === 'question') {
    if (!experimentalApi) return send({ id: message.id, error: { message: 'request_user_input requires experimentalApi capability' } });
    send({ id: 'question-1', method: 'item/tool/requestUserInput', params: {
      threadId: 'original', turnId: 'turn-1', itemId: 'question-tool', isBlocking: true,
      questions: [{ id: 'scope', header: '范围', question: '选择范围', options: null }],
    } });
  }
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
