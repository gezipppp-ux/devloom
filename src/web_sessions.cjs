const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { AppServer } = require('./app_server.cjs');
const { RunStore, OUTPUT_LIMIT, normalizeItem } = require('./web_store.cjs');
const { runExecution, saveState } = require('./execution_runner.cjs');
const { defaultChannels } = require('./channels/registry.cjs');
const { executionConfig, readOptional } = require('./settings.cjs');
const { sourceFor, runKey } = require('./run_identity.cjs');
const { validateModelSelection } = require('./codex_models.cjs');
const { validateTaskMetadata, defaultTaskMetadata } = require('./task_metadata.cjs');

function initializationItem(entry, index) {
  return {
    id: `worktree-init-${index}`,
    type: 'worktreeInitialization',
    command: entry.command,
    status: entry.status === 'running' ? 'inProgress' : entry.status,
    output: entry.output,
    exitCode: entry.exit_code,
    error: entry.error,
  };
}

class WebSessions extends EventEmitter {
  constructor({
    runsDirectory,
    configFile,
    client,
    store,
    run = runExecution,
    channels,
  }) {
    super();
    this.configFile = configFile;
    this.store = store || new RunStore(runsDirectory);
    this.client = client || new AppServer(readOptional(configFile).codex);
    this.channels = channels || defaultChannels(configFile);
    this.run = run;
    this.sessions = new Map();
    this.operations = new Map();
    this.client.on('notification', (message) => this.notification(message));
    this.client.on('request', (message) => this.serverRequest(message));
    this.client.on('disconnected', (error) => {
      for (const runtime of this.sessions.values()) {
        runtime.connected = false;
        runtime.requests.clear();
        if (runtime.turnId) {
          runtime.status = 'disconnected';
          runtime.error = error.message;
        }
        clearTimeout(runtime.initial?.timer);
        runtime.initial?.reject(error);
        runtime.initial = null;
        this.publish(runtime, { type: 'state' });
      }
    });
  }

  runtime(key, sessionId) {
    let runtime = this.sessions.get(key);
    if (!runtime) {
      runtime = {
        key,
        sessionId,
        status: 'idle',
        turnId: null,
        connected: false,
        items: new Map(),
        requests: new Map(),
        completedTurns: new Set(),
        lastActivity: null,
      };
      this.sessions.set(key, runtime);
    }
    return runtime;
  }

  publish(runtime, event) {
    runtime.lastActivity = new Date().toISOString();
    const data = {
      key: runtime.key,
      at: runtime.lastActivity,
      status: runtime.status,
      turnId: runtime.turnId,
      sessionId: runtime.sessionId,
      ...event,
    };
    this.store.log(
      runtime.key,
      event.type === 'item'
        ? {
            ...data,
            item: {
              id: event.item.id,
              type: event.item.type,
              status: event.item.status,
            },
          }
        : data,
    );
    this.emit('event', data);
  }

  persist(runtime) {
    const previous = this.store.readWeb(runtime.key);
    this.store.writeWeb(runtime.key, {
      ...previous,
      sessionId: runtime.sessionId,
      turnId: runtime.turnId,
      status: runtime.status,
      lastActivity: runtime.lastActivity,
    });
  }

  notification({ method, params = {} }) {
    const runtime = [...this.sessions.values()].find(
      (entry) =>
        entry.sessionId === params.threadId ||
        (method === 'serverRequest/resolved' &&
          entry.requests.has(String(params.requestId))),
    );
    if (!runtime) return;
    try {
      if (method === 'turn/started') {
        runtime.turnId = params.turn.id;
        runtime.status = 'running';
        runtime.connected = true;
        runtime.error = null;
        if (runtime.initial && !runtime.initial.started) {
          const initial = runtime.initial;
          initial.started = true;
          clearTimeout(initial.timer);
          initial.callback = Promise.resolve()
            .then(initial.onStarted)
            .catch((error) => {
              initial.callbackError = error;
            });
        } else if (!runtime.initial) {
          const state = this.store.read(runtime.key);
          state.execution = {
            status: 'running',
            session_id: runtime.sessionId,
          };
          saveState(path.join(this.store.dir(runtime.key), 'run.json'), state);
        }
        this.publish(runtime, { type: 'state' });
        this.persist(runtime);
      } else if (method === 'turn/completed') {
        void this.completed(runtime, params.turn).catch((error) => {
          runtime.error = error.message;
          runtime.status = 'error';
          runtime.initial?.reject(error);
          this.publish(runtime, { type: 'state', error: error.message });
        });
      } else if (method === 'item/started' || method === 'item/completed') {
        const previous = runtime.items.get(params.item.id);
        const item = normalizeItem(params.item, params.turnId);
        item.status =
          params.item.status ||
          (method === 'item/started' ? 'inProgress' : 'completed');
        item.output ||= previous?.output || '';
        item.text ||= previous?.text || '';
        runtime.items.set(item.id, item);
        this.publish(runtime, { type: 'item', item });
      } else if (
        method === 'item/agentMessage/delta' ||
        method === 'item/commandExecution/outputDelta'
      ) {
        const isMessage = method === 'item/agentMessage/delta';
        const item = runtime.items.get(params.itemId) || {
          id: params.itemId,
          turnId: params.turnId,
          type: isMessage ? 'agentMessage' : 'commandExecution',
          status: 'inProgress',
          text: '',
          output: '',
        };
        const property = isMessage ? 'text' : 'output';
        item[property] = `${item[property] || ''}${params.delta || ''}`.slice(
          -OUTPUT_LIMIT,
        );
        runtime.items.set(item.id, item);
        this.publish(runtime, { type: 'item', item });
      } else if (method === 'serverRequest/resolved') {
        runtime.requests.delete(String(params.requestId));
        this.publish(runtime, {
          type: 'requests',
          requests: [...runtime.requests.values()],
        });
      }
      while (runtime.items.size > 500)
        runtime.items.delete(runtime.items.keys().next().value);
    } catch (error) {
      runtime.error = error.message;
      this.emit('event', {
        key: runtime.key,
        type: 'error',
        error: error.message,
      });
    }
  }

  async completed(runtime, turn) {
    if (runtime.turnId && runtime.turnId !== turn.id) return;
    const initial = runtime.initial;
    runtime.completedTurns.add(turn.id);
    if (runtime.completedTurns.size > 500)
      runtime.completedTurns.delete(
        runtime.completedTurns.values().next().value,
      );
    if (initial?.callback) await initial.callback;
    runtime.turnId = null;
    runtime.status = turn.status;
    runtime.error = turn.error?.message || null;
    runtime.requests.clear();
    for (const item of runtime.items.values()) {
      if (item.turnId === turn.id && item.status === 'inProgress')
        item.status = turn.status;
    }
    const state = this.store.read(runtime.key);
    state.execution = {
      status: turn.status,
      session_id: runtime.sessionId,
      completed: turn.status === 'completed',
      error: runtime.error,
    };
    saveState(path.join(this.store.dir(runtime.key), 'run.json'), state);
    this.publish(runtime, {
      type: 'state',
      error: runtime.error,
      requests: [],
    });
    this.persist(runtime);
    const lastMessage = [...runtime.items.values()]
      .filter((item) => item.turnId === turn.id && item.type === 'agentMessage')
      .at(-1);
    if (lastMessage)
      fs.writeFileSync(
        path.join(this.store.dir(runtime.key), 'final.md'),
        lastMessage.text,
        { mode: 0o600 },
      );
    if (initial) clearTimeout(initial.timer);
    runtime.initial = null;
    if (initial) {
      if (initial.callbackError) initial.reject(initial.callbackError);
      else
        initial.resolve({
          session_id: runtime.sessionId,
          completed: turn.status === 'completed',
          status: turn.status,
          error: runtime.error,
        });
    }
  }

  serverRequest(message) {
    const runtime = [...this.sessions.values()].find(
      (entry) => entry.sessionId === message.params?.threadId,
    );
    const supported = [
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/tool/requestUserInput',
    ];
    if (!runtime || !supported.includes(message.method)) {
      this.client.reject(
        message.id,
        'This Web CLI cannot handle this request. No permission was granted.',
      );
      if (runtime)
        this.publish(runtime, {
          type: 'error',
          error: `暂不支持交互请求 ${message.method}，已拒绝。`,
        });
      return;
    }
    const request = {
      id: String(message.id),
      rpcId: message.id,
      method: message.method,
      params: message.params,
    };
    runtime.requests.set(request.id, request);
    this.publish(runtime, {
      type: 'requests',
      requests: [...runtime.requests.values()],
    });
  }

  async respond(key, requestId, response) {
    const runtime = this.sessions.get(key);
    const request = runtime?.requests.get(String(requestId));
    if (!request || !runtime.connected)
      throw new Error('该请求已失效，请刷新会话。');
    let result;
    if (request.method === 'item/tool/requestUserInput') {
      const answers = {};
      for (const question of request.params.questions) {
        const answer = response.answers?.[question.id];
        if (
          typeof answer !== 'string' ||
          !answer.trim() ||
          answer.length > 20000
        )
          throw new Error('请回答每个问题。');
        answers[question.id] = { answers: [answer.trim()] };
      }
      result = { answers };
    } else {
      if (!['accept', 'decline'].includes(response.decision))
        throw new Error('无效的审批决定。');
      result = { decision: response.decision };
    }
    this.client.respond(request.rpcId, result);
    runtime.requests.delete(request.id);
    this.publish(runtime, {
      type: 'requests',
      requests: [...runtime.requests.values()],
    });
  }

  async history(key, cursor) {
    const state = this.store.read(key);
    if (!state.session_id) return { items: [], nextCursor: null };
    await this.client.connect();
    const result = await this.client.request('thread/items/list', {
      threadId: state.session_id,
      limit: 50,
      sortDirection: 'desc',
      ...(cursor ? { cursor } : {}),
    });
    return {
      items: result.data
        .map((entry) => normalizeItem(entry.item, entry.turnId))
        .reverse(),
      nextCursor: result.nextCursor,
    };
  }

  async view(key) {
    const runtime = this.sessions.get(key);
    let state;
    try {
      state = this.store.read(key);
    } catch (error) {
      if (error.code !== 'ENOENT' || !runtime) throw error;
      return {
        key,
        title: '正在准备需求',
        status: runtime.status,
        items: [],
        requests: [],
        images: [],
        error: runtime.error,
        readOnlyReason: '正在准备工作区，请稍候',
      };
    }
    let history;
    let warning;
    try {
      history = await this.history(key);
    } catch (error) {
      history = { items: this.store.legacyHistory(key), nextCursor: null };
      warning = error.message;
    }
    const items = new Map(history.items.map((item) => [item.id, item]));
    const initializationItems = (state.initialization?.commands || []).map(
      initializationItem,
    );
    if (runtime) for (const [id, item] of runtime.items) items.set(id, item);
    let readOnlyReason = this.store.worktreeReason(state);
    if (
      !readOnlyReason &&
      fs.existsSync(path.join(this.store.dir(key), '.lock')) &&
      !runtime?.initial &&
      !['preparing', 'initializing'].includes(runtime?.status)
    )
      readOnlyReason = '任务仍由另一个 CLI 运行器持有；结束后才能在网页继续。';
    if (
      runtime &&
      ['preparing', 'initializing', 'starting'].includes(runtime.status)
    )
      readOnlyReason ||= '正在准备会话，请稍候';
    if (!state.session_id)
      readOnlyReason ||= '尚未创建 Codex session，请查看准备或初始化记录。';
    return {
      ...this.store.summary(key, state),
      status:
        runtime?.status ||
        (['running', 'initializing'].includes(state.execution.status)
          ? 'disconnected'
          : state.execution.status),
      turnId: runtime?.turnId,
      connected: runtime?.connected || false,
      error: runtime?.error || state.execution.error,
      lastActivity: runtime?.lastActivity || state.updated_at,
      readOnlyReason,
      warning,
      items: [
        ...new Map(
          [...initializationItems, ...items.values()].map((item) => [
            item.id,
            item,
          ]),
        ).values(),
      ],
      nextCursor: history.nextCursor,
      requests: [...(runtime?.requests.values() || [])],
      images: this.store.images(key),
      requirement: this.store.requirement(key, state),
    };
  }

  exclusive(key, operation) {
    if (this.operations.has(key))
      throw new Error('该任务的上一条操作尚未完成。');
    const pending = Promise.resolve()
      .then(operation)
      .finally(() => this.operations.delete(key));
    this.operations.set(key, pending);
    return pending;
  }

  async attach(key) {
    const state = this.store.read(key);
    const reason = this.store.worktreeReason(state);
    if (reason) throw new Error(reason);
    const runtime = this.runtime(key, state.session_id);
    if (['preparing', 'initializing', 'starting'].includes(runtime.status))
      throw new Error('正在准备会话，请稍候。');
    if (runtime.connected) return runtime;
    if (!state.session_id) throw new Error('该任务尚未创建 Codex session。');
    if (fs.existsSync(path.join(this.store.dir(key), '.lock')))
      throw new Error('原 CLI 仍持有任务锁，不能并发接管。');
    this.store.claim(key);
    await this.client.connect();
    const before = await this.client.request('thread/read', {
      threadId: state.session_id,
      includeTurns: false,
    });
    if (before.thread.status.type === 'active')
      throw new Error('该 session 正在另一个客户端执行，请等待该轮结束。');
    await this.client.request('thread/resume', {
      threadId: state.session_id,
      cwd: state.worktree.path,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      excludeTurns: true,
      ...(state.codex?.model ? { model: state.codex.model } : {}),
    });
    runtime.connected = true;
    runtime.turnId = null;
    runtime.status = 'idle';
    this.publish(runtime, { type: 'state' });
    return runtime;
  }

  async send(key, message) {
    if (
      typeof message !== 'string' ||
      !message.trim() ||
      message.length > 60000
    )
      throw new Error('消息需为 1–60000 个字符。');
    return this.exclusive(key, async () => {
      const runtime = await this.attach(key);
      if (runtime.requests.size)
        throw new Error('请先处理当前等待中的问题或审批。');
      const input = [{ type: 'text', text: message.trim(), text_elements: [] }];
      const activeTurn = runtime.turnId;
      if (activeTurn) {
        await this.client.request('turn/steer', {
          threadId: runtime.sessionId,
          expectedTurnId: activeTurn,
          input,
        });
        this.publish(runtime, {
          type: 'notice',
          text: '补充指令已发送至当前一轮。',
        });
      } else {
        let result;
        const savedCodex = this.store.read(key).codex || {};
        try {
          result = await this.client.request('turn/start', {
            threadId: runtime.sessionId,
            input,
            ...(savedCodex.model ? { model: savedCodex.model } : {}),
            ...(savedCodex.reasoning_effort ? { effort: savedCodex.reasoning_effort } : {}),
          });
        } catch (error) {
          runtime.connected = false;
          runtime.status = 'disconnected';
          this.publish(runtime, { type: 'state', error: error.message });
          throw error;
        }
        if (
          result.turn.status === 'inProgress' &&
          !runtime.completedTurns.has(result.turn.id)
        ) {
          runtime.turnId = result.turn.id;
          runtime.status = 'running';
        }
        this.publish(runtime, { type: 'state' });
      }
      return { sessionId: runtime.sessionId, turnId: runtime.turnId };
    });
  }

  async interrupt(key) {
    return this.exclusive(key, async () => {
      const runtime = this.sessions.get(key);
      if (runtime?.status === 'initializing' && runtime.prepareAbort) {
        runtime.prepareAbort.abort();
        this.publish(runtime, {
          type: 'notice',
          text: '已请求停止 worktree 初始化。',
        });
        return { accepted: true };
      }
      if (!runtime?.connected || !runtime.turnId)
        throw new Error('没有可中断的网页执行轮次。');
      await this.client.request('turn/interrupt', {
        threadId: runtime.sessionId,
        turnId: runtime.turnId,
      });
      this.publish(runtime, {
        type: 'notice',
        text: '已请求停止当前一轮，等待 Codex 确认。',
      });
      return { accepted: true };
    });
  }

  async start(input) {
    validateTaskMetadata(input.metadata === undefined ? {} : input.metadata);
    const channel = this.channels.get(input.channel || 'tapd');
    const selection = await validateModelSelection(this.client, input);
    const sourceInput = { ...input };
    delete sourceInput.model;
    delete sourceInput.reasoningEffort;
    delete sourceInput.metadata;
    const resolved = await channel.resolve(sourceInput);
    const source = sourceFor(channel.id, resolved.item);
    const key = runKey(source);
    return this.launch(
      key,
      resolved.item,
      { ...resolved.config, codex: { ...resolved.config.codex, ...selection } },
      resolved.session,
      {},
      channel,
      validateTaskMetadata(input.metadata || {}, defaultTaskMetadata(resolved.item)),
    );
  }

  launch(
    key,
    item,
    config,
    session,
    _fields,
    channel = this.channels.get('tapd'),
    metadata = defaultTaskMetadata(item),
  ) {
    metadata = validateTaskMetadata(metadata);
    config = executionConfig(config, this.configFile);
    const source = sourceFor(channel.id, item);
    if (
      this.sessions.has(key) ||
      fs.existsSync(path.join(this.store.dir(key), 'run.json'))
    )
      throw new Error('该需求已有运行记录。');
    // Resolve before creating run ownership, downloading images or creating a branch.
    this.client.validateCommand?.();
    this.store.claim(key);
    this.store.writeTaskMetadata(key, metadata, item);
    const runtime = this.runtime(key);
    runtime.prepareAbort = new AbortController();
    runtime.status = 'preparing';
    runtime.connected = false;
    const directory = this.store.dir(key);
    fs.mkdirSync(directory, { recursive: true });
    this.store.writeWeb(key, { source });
    this.publish(runtime, { type: 'state', title: '正在抓取需求并准备工作区' });
    runtime.operation = this.run(
      {
        config,
        channel,
        configFile: this.configFile,
        session,
        item,
        directory,
      },
      {
        signal: runtime.prepareAbort.signal,
        onInitialization: (initialization, index) => {
          const previousStatus = runtime.status;
          runtime.status = 'initializing';
          if (previousStatus !== runtime.status)
            this.publish(runtime, { type: 'state' });
          const item = initializationItem(
            initialization.commands[index],
            index,
          );
          runtime.items.set(item.id, item);
          this.publish(runtime, { type: 'item', item });
        },
        startSession: async ({ repository, task, onSession, onStarted }) => {
          await this.client.connect();
          const result = await this.client.request('thread/start', {
            cwd: repository,
            approvalPolicy: 'on-request',
            sandbox: 'workspace-write',
            ephemeral: false,
            ...(config.codex?.model ? { model: config.codex.model } : {}),
          });
          runtime.sessionId = result.thread.id;
          runtime.status = 'starting';
          runtime.connected = true;
          onSession(runtime.sessionId);
          this.persist(runtime);
          return new Promise((resolve, reject) => {
            runtime.initial = { resolve, reject, onStarted, started: false };
            runtime.initial.timer = setTimeout(() => {
              reject(
                new Error(
                  '未收到 Codex 执行开始确认，请刷新确认状态，勿重复启动。',
                ),
              );
            }, config.codex?.startup_timeout_ms || 120000);
            const input = [
              { type: 'text', text: task.codex_prompt, text_elements: [] },
              ...task.images.map((image) => ({
                type: 'localImage',
                path: image.path,
              })),
            ];
            this.client
              .request('turn/start', { threadId: runtime.sessionId, input, ...(config.codex?.reasoning_effort ? { effort: config.codex.reasoning_effort } : {}) })
              .then((response) => {
                if (
                  runtime.initial &&
                  !runtime.turnId &&
                  response.turn.status === 'inProgress'
                )
                  runtime.turnId = response.turn.id;
              })
              .catch(reject);
          });
        },
      },
    )
      .then((state) => {
        runtime.prepareAbort = null;
        if (runtime.initial && !runtime.initial.started)
          runtime.connected = false;
        clearTimeout(runtime.initial?.timer);
        runtime.initial = null;
        runtime.status = state.execution.status;
        runtime.error = state.execution.error;
        this.publish(runtime, { type: 'state' });
      })
      .catch((error) => {
        runtime.prepareAbort = null;
        runtime.connected = false;
        clearTimeout(runtime.initial?.timer);
        runtime.initial = null;
        runtime.status = 'failed';
        runtime.error = error.message;
        this.publish(runtime, { type: 'error', error: error.message });
        if (!fs.existsSync(path.join(directory, 'run.json')))
          this.sessions.delete(key);
      });
    return { key, accepted: true };
  }

  list() {
    const saved = new Map(this.store.list().map((entry) => [entry.key, entry]));
    for (const runtime of this.sessions.values()) {
      saved.set(runtime.key, {
        ...(saved.get(runtime.key) || {
          key: runtime.key,
          title: '正在准备需求',
          metadata: this.store.readTaskMetadata(runtime.key),
        }),
        status: runtime.status,
        sessionId: runtime.sessionId,
        updatedAt: runtime.lastActivity,
      });
    }
    return [...saved.values()].sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
  }

  updateTaskMetadata(key, input) {
    const state = this.store.read(key);
    const metadata = this.store.writeTaskMetadata(key, input, state.workitem);
    this.emit('event', { key, type: 'metadata', metadata, at: new Date().toISOString() });
    return { metadata };
  }

  async close() {
    for (const runtime of this.sessions.values()) {
      runtime.prepareAbort?.abort();
      if (runtime.connected && runtime.turnId) {
        try {
          await this.client.request(
            'turn/interrupt',
            { threadId: runtime.sessionId, turnId: runtime.turnId },
            3000,
          );
        } catch {
          /* Preserve the session for recovery. */
        }
      }
    }
    this.client.close();
    await Promise.allSettled(
      [...this.sessions.values()]
        .map((runtime) => runtime.operation)
        .filter(Boolean),
    );
    this.store.releaseAll();
  }
}

module.exports = { WebSessions };
