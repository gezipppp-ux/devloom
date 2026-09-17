const { EventEmitter } = require('node:events');
class FakeClient extends EventEmitter {
  calls = [];
  turn = 0;
  async connect() {}
  notify(method, params) {
    this.emit('notification', {
      method,
      params: { threadId: 'original', ...params },
    });
  }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/read')
      return { thread: { status: { type: 'idle' } } };
    if (method === 'thread/start') return { thread: { id: 'original' } };
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
      this.notify('turn/started', { turn });
      this.notify('item/started', {
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
        turn: { id: params.turnId, status: 'interrupted' },
      });
    return {};
  }
  respond(id, result) {
    this.calls.push({ response: id, result });
  }
  reject(id, error) {
    this.calls.push({ rejected: id, error });
  }
  close() {
    this.emit('disconnected', new Error('closed'));
  }
}

module.exports = { FakeClient };
