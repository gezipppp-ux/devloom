const { EventEmitter } = require('node:events');
class FakeClient extends EventEmitter {
  calls = [];
  turn = 0;
  thread = 0;
  async connect() {}
  async inspectExecutionCapabilities() { return { autoReview: true }; }
  notify(method, params) {
    this.emit('notification', {
      method,
      params: { threadId: 'original', ...params },
    });
  }
  async request(method, params) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'model/list') return { data: [
      { model: 'fixture-model-a', displayName: 'Fixture A', isDefault: true, supportedReasoningEfforts: [{reasoningEffort:'low'},{reasoningEffort:'high'}], defaultReasoningEffort:'low' },
      { model: 'fixture-model-b', displayName: 'Fixture B', supportedReasoningEfforts: [{reasoningEffort:'low'},{reasoningEffort:'medium'}], defaultReasoningEffort:'medium' }
    ], nextCursor: null };
    if (method === 'config/read')
      return { config: { model: 'fixture-model-a', model_reasoning_effort: 'low' } };
    if (method === 'thread/read')
      return { thread: { status: { type: 'idle' } } };
    if (method === 'thread/start') return { thread: { id: ++this.thread === 1 ? 'original' : `original-${this.thread}` } };
    if (method === 'thread/items/list')
      return {
        data: [
          {
            turnId: 'old',
            item: { id: 'history', type: 'agentMessage', text: '历史回复' },
          },
        ],
        nextCursor: 'older',
      };
    if (method === 'turn/start') {
      const turn = { id: `turn-${++this.turn}`, status: 'inProgress' };
      this.notify('turn/started', { threadId: params.threadId, turn });
      this.notify('item/started', {
        threadId: params.threadId,
        turnId: turn.id,
        item: {
          id: `user-${this.turn}`,
          type: 'userMessage',
          content: params.input,
        },
      });
      return { turn };
    }
    if (method === 'turn/interrupt')
      this.notify('turn/completed', {
        threadId: params.threadId,
        turn: { id: params.turnId, status: 'interrupted' },
      });
    return {};
  }
  respond(id, result) {
    this.calls.push({ response: id, result: structuredClone(result) });
  }
  reject(id, error) {
    this.calls.push({ rejected: id, error: structuredClone(error) });
  }
  close() {
    this.emit('disconnected', new Error('closed'));
  }
}

module.exports = { FakeClient };
