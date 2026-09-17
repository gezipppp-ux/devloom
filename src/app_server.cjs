const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { resolveCodex } = require('./codex_command.cjs');

class AppServer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.pending = new Map();
    this.nextId = 0;
  }

  async connect() {
    if (this.connection) return this.connection;
    this.connection = this.open();
    try {
      return await this.connection;
    } catch (error) {
      this.close();
      this.connection = null;
      throw error;
    }
  }

  async open() {
    const { command, args } = this.validateCommand();
    const env = { ...process.env };
    delete env.CODEX_THREAD_ID;
    for (const key of Object.keys(env))
      if (key.startsWith('TAPD_')) delete env[key];
    const child = spawn(command, [...args, 'app-server', '--stdio'], {
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const disconnect = (error) => {
      if (this.child === child) this.disconnected(error);
    };
    child.on('error', disconnect);
    child.once('close', () =>
      disconnect(new Error('Codex 连接已关闭。重新连接后可继续原 session。')),
    );
    child.stdin.on('error', disconnect);
    child.stderr.on('data', (chunk) =>
      this.emit('diagnostic', chunk.toString().slice(-4000)),
    );
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.child !== child) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.method) {
        this.emit(
          message.id === undefined ? 'notification' : 'request',
          message,
        );
      } else {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(new Error(message.error.message || 'Codex 请求失败'));
        else pending.resolve(message.result);
      }
    });
    await this.request('initialize', {
      clientInfo: {
        name: 'tapd_web_cli',
        title: 'TAPD Web CLI',
        version: '0.1.0',
      },
      capabilities: { experimentalApi: false },
    });
    this.write({ method: 'initialized', params: {} });
  }

  validateCommand() {
    return resolveCodex(this.config);
  }

  write(message) {
    if (!this.child?.stdin.writable) throw new Error('Codex 尚未连接。');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeout = 30000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Codex ${method} 超时。请先刷新确认实际状态，不要重复启动。`,
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  respond(id, result) {
    this.write({ id, result });
  }
  reject(id, message) {
    this.write({ id, error: { code: -32601, message } });
  }

  disconnected(error) {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.connection = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    child.kill();
    this.emit('disconnected', error);
  }

  close() {
    this.disconnected(new Error('Web CLI 服务已关闭。'));
  }
}

module.exports = { AppServer };
