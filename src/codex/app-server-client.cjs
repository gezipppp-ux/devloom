const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { resolveCodex } = require('./command.cjs');
const { inspectExecutionCapabilities } = require('./capabilities.cjs');
const { stopProcessTree } = require('./process-tree.cjs');
const { childEnvironment } = require('./environment.cjs');

class AppServerClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
    this.closedChildren = new WeakSet();
    this.stopping = new Set();
  }

  async connect() {
    if (this.closed) throw new Error('Web CLI 服务已关闭。');
    if (this.connection) return this.connection;
    const connection = this.open();
    this.connection = connection;
    try {
      return await connection;
    } catch (error) {
      if (this.connection === connection) {
        this.disconnected(error);
        if (this.connection === connection) this.connection = null;
      }
      throw error;
    }
  }

  async open() {
    const { command, args } = this.validateCommand();
    const env = childEnvironment();
    const child = spawn(command, [...args, 'app-server', '--stdio'], {
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const disconnect = (error) => {
      if (this.child === child) this.disconnected(error);
    };
    child.on('error', disconnect);
    child.once('close', () => {
      this.closedChildren.add(child);
      disconnect(new Error('Codex 连接已关闭。重新连接后可继续原 session。'));
    });
    child.stdin.on('error', disconnect);
    child.stdout.on('error', disconnect);
    child.stdout.once('end', () =>
      disconnect(
        new Error('Codex 输出连接已关闭。重新连接后可继续原 session。'),
      ),
    );
    child.stdout.once('close', () =>
      disconnect(
        new Error('Codex 输出连接已关闭。重新连接后可继续原 session。'),
      ),
    );
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
      if (!message || typeof message !== 'object' || Array.isArray(message))
        return;
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
    if (this.child !== child) throw new Error('Codex 初始化连接已关闭。');
    this.write({ method: 'initialized', params: {} });
  }

  validateCommand() {
    if (this.closed) throw new Error('Web CLI 服务已关闭。');
    return resolveCodex(this.config);
  }

  inspectExecutionCapabilities() {
    return inspectExecutionCapabilities(this.validateCommand());
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
    const closed = this.closedChildren.has(child)
      ? Promise.resolve()
      : new Promise((resolve) => child.once('close', resolve));
    const stopped = Promise.all([closed, stopProcessTree(child)]).finally(() =>
      this.stopping.delete(stopped),
    );
    this.stopping.add(stopped);
    this.emit('disconnected', error);
  }

  close() {
    this.closed = true;
    this.disconnected(new Error('Web CLI 服务已关闭。'));
    return Promise.allSettled([...this.stopping]);
  }
}

module.exports = { AppServerClient };
