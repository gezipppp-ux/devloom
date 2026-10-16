const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { resolveCodex } = require('./command.cjs');
const { inspectExecutionCapabilities } = require('./capabilities.cjs');
const { stopProcessTree } = require('../shared/process-tree.cjs');
const { childEnvironment } = require('../shared/child-environment.cjs');

class AppServerClient extends EventEmitter {
  constructor(config = {}, { gitCredentialProvider, gitCredentialRevision, supplier } = {}) {
    super();
    this.config = config;
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
    this.closedChildren = new WeakSet();
    this.stopping = new Set();
    this.gitCredentialProvider = gitCredentialProvider;
    this.gitCredentialRevision = gitCredentialRevision;
    this.gitCredentials = null;
    this.supplier = supplier;
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
    if (this.supplier?.mode === "api-key" && !(await this.inspectExecutionCapabilities()).supplierConfiguration)
      throw new Error("当前 Codex 不支持供应商配置覆盖，请更新 Codex 后重试。");
    const credentials = await this.getGitCredentials();
    if (this.closed) throw new Error('Web CLI 服务已关闭。');
    const env = {
      ...childEnvironment(process.env, { stripGit: Boolean(credentials) }),
      ...(credentials?.env || {}),
      ...(this.supplier?.mode === "api-key" ? { DEVLOOM_AGENT_API_KEY: this.supplier.apiKey } : {}),
    };
    const overrides = this.supplier?.mode === "api-key" ? {
      model_provider: "web_coding_supplier",
      model: this.supplier.defaultModel,
      "model_providers.web_coding_supplier.name": "DevLoom",
      "model_providers.web_coding_supplier.base_url": this.supplier.baseUrl,
      "model_providers.web_coding_supplier.env_key": "DEVLOOM_AGENT_API_KEY",
      "model_providers.web_coding_supplier.wire_api": "responses",
      "model_providers.web_coding_supplier.requires_openai_auth": false,
    } : {};
    const overrideArgs = Object.entries(overrides).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`]);
    const child = spawn(command, [...args, ...overrideArgs, 'app-server', '--stdio'], {
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
      this.emit('diagnostic', this.redact(chunk.toString()).slice(-4000)),
    );
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.child !== child) return;
      let message;
      try {
        message = this.redact(JSON.parse(line));
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
        name: 'devloom',
        title: 'DevLoom',
        version: '0.1.0',
      },
      // request_user_input is an experimental app-server request, even when
      // the model offers it during an ordinary turn.
      capabilities: { experimentalApi: true },
    });
    if (this.child !== child) throw new Error('Codex 初始化连接已关闭。');
    this.write({ method: 'initialized', params: {} });
  }

  async getGitCredentials() {
    if (!this.gitCredentialProvider || this.gitCredentials)
      return this.gitCredentials;
    const credentials = await this.gitCredentialProvider();
    if (!credentials || typeof credentials !== 'object' ||
      !credentials.env || typeof credentials.env !== 'object' ||
      Array.isArray(credentials.env))
      throw new Error('Git 凭据环境无效。');
    if (this.closed) {
      await credentials.dispose?.();
      throw new Error('Web CLI 服务已关闭。');
    }
    this.gitCredentials = credentials;
    return credentials;
  }

  async gitIdentityConfig(cwd) {
    if (!this.gitCredentialProvider) return undefined;
    const credentials = await this.getGitCredentials();
    const result = await this.request('config/read', { cwd, includeLayers: false });
    if (!result?.config || typeof result.config !== 'object' || Array.isArray(result.config))
      throw new Error('无法读取 Codex 命令环境配置。');
    // config/read exposes unset fields as null. Session flags convert JSON
    // null to a TOML string, which is invalid for arrays, booleans and enums.
    const policy = Object.fromEntries(Object.entries(result.config.shell_environment_policy || {})
      .filter(([, value]) => value !== null && value !== undefined));
    // Process inheritance alone is insufficient when Codex filters shell env.
    // Only public commit identity may enter persisted thread configuration.
    const names = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
    const identity = Object.fromEntries(names.filter(name => typeof credentials.env[name] === 'string')
      .map(name => [name, credentials.env[name]]));
    const environment = { ...policy, set: { ...policy.set, ...identity } };
    const filters = policy.filters;
    if (filters && Object.values(filters).includes('include')) {
      environment.filters = { ...filters, ...Object.fromEntries(Object.keys(identity).map(name => [name, 'include'])) };
    } else if (policy.include_only?.length) {
      environment.include_only = [...new Set([...policy.include_only, ...Object.keys(identity)])];
    }
    // Rebuild even after clearing the author, so resumed threads lose old values.
    return { shell_environment_policy: environment };
  }

  redact(value) {
    const key = this.supplier?.apiKey;
    if (!key) return value;
    if (typeof value === 'string') return value.replaceAll(key, '[redacted]');
    if (Array.isArray(value)) return value.map(item => this.redact(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, this.redact(item)]));
    return value;
  }

  // The application must first fence active turns, approvals and startup work.
  // The application reserves the operation while the revision is checked.
  async refreshGitCredentials() {
    if (this.closed || !this.child || this.pending.size ||
      !this.gitCredentials || !this.gitCredentialRevision) return false;
    const child = this.child;
    const credentials = this.gitCredentials;
    const revision = await this.gitCredentialRevision();
    if (this.closed || this.child !== child || this.gitCredentials !== credentials || this.pending.size) return false;
    if (revision === credentials.revision) return false;
    this.disconnected(new Error('Git 账号已更新，将使用新凭据继续原 session。'));
    return true;
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
    const credentials = this.gitCredentials;
    this.gitCredentials = null;
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
    const stopped = Promise.all([closed, stopProcessTree(child)])
      .then(() => credentials?.dispose?.())
      .finally(() => this.stopping.delete(stopped));
    stopped.catch(() => this.emit('diagnostic', '无法清理 Git 临时配置，请检查服务端临时目录权限。'));
    this.stopping.add(stopped);
    this.emit('disconnected', error);
  }

  async close() {
    this.closed = true;
    this.disconnected(new Error('Web CLI 服务已关闭。'));
    await Promise.allSettled([...this.stopping]);
    const credentials = this.gitCredentials;
    this.gitCredentials = null;
    await credentials?.dispose?.();
  }
}

module.exports = { AppServerClient };
