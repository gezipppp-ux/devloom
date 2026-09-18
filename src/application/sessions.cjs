const { EventEmitter } = require("node:events");
const { AppServer } = require("../codex/app-server.cjs");
const { RunStore } = require("../storage/run-store.cjs");
const { initializationItem } = require("../domain/session-item.cjs");
const {
  worktreeReason: defaultWorktreeReason,
} = require("../git/worktree-access.cjs");
const { SessionEvents } = require("./session-events.cjs");
const { SessionViews } = require("./session-views.cjs");
const { SessionSettings } = require("./session-settings.cjs");
const { runExecution } = require("../execution/runner.cjs");
const { defaultChannels } = require("../channels/registry.cjs");
const { executionConfig } = require("../config/execution-settings.cjs");
const { readOptional } = require("../storage/json-files.cjs");
const { sourceFor, runKey } = require("../domain/run-identity.cjs");
const {
  validateModelSelection,
  resolveTurnModel,
} = require("../codex/models.cjs");
const {
  assertPermissionAvailable,
  threadPermissionParams,
  turnPermissionParams,
} = require("../codex/permissions.cjs");
const { validatePermissionMode } = require("../domain/permissions.cjs");
const {
  validateTaskMetadata,
  defaultTaskMetadata,
} = require("../domain/task-metadata.cjs");

class WebSessions extends EventEmitter {
  constructor({
    runsDirectory,
    configFile,
    client,
    store,
    run = runExecution,
    channels,
    worktreeReason = defaultWorktreeReason,
    apiPrefix = "/api",
  }) {
    super();
    this.configFile = configFile;
    this.store = store || new RunStore(runsDirectory);
    this.client = client || new AppServer(readOptional(configFile).codex);
    this.channels = channels || defaultChannels(configFile);
    this.run = run;
    this.sessions = new Map();
    this.operations = new Map();
    this.closing = false;
    this.worktreeReason = worktreeReason;
    this.settings = new SessionSettings({
      store: this.store,
      client: this.client,
      sessions: this.sessions,
      worktreeReason: (state) => this.worktreeReason(state),
      emit: (event) => this.emit("event", event),
      assertOpen: () => this.assertOpen(),
    });
    this.events = new SessionEvents({
      store: this.store,
      client: this.client,
      sessions: this.sessions,
      settings: this.settings,
      emit: (event) => this.emit("event", event),
    });
    this.views = new SessionViews({
      store: this.store,
      client: this.client,
      sessions: this.sessions,
      settings: this.settings,
      worktreeReason: (state) => this.worktreeReason(state),
      apiPrefix,
      assertOpen: () => this.assertOpen(),
    });
  }

  runtime(key, sessionId) {
    let runtime = this.sessions.get(key);
    if (!runtime) {
      runtime = {
        key,
        sessionId,
        status: "idle",
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
    this.events.publish(runtime, event);
  }

  respond(key, requestId, response) {
    this.assertOpen();
    return this.events.respond(key, requestId, response);
  }

  history(key, cursor) {
    return this.views.history(key, cursor);
  }

  view(key) {
    return this.views.view(key);
  }

  exclusive(key, operation) {
    this.assertOpen();
    if (this.operations.has(key))
      throw new Error("该任务的上一条操作尚未完成。");
    const pending = Promise.resolve()
      .then(() => {
        this.assertOpen();
        return operation();
      })
      .finally(() => this.operations.delete(key));
    this.operations.set(key, pending);
    return pending;
  }

  async attach(key) {
    this.assertOpen();
    const state = this.store.read(key);
    const reason = this.worktreeReason(state);
    if (reason) throw new Error(reason);
    const runtime = this.runtime(key, state.session_id);
    if (["preparing", "initializing", "starting"].includes(runtime.status))
      throw new Error("正在准备会话，请稍候。");
    if (runtime.connected) {
      if (!runtime.turnId && runtime.pipelineActive)
        throw new Error("正在完成首轮记录，请稍候再发送。");
      return runtime;
    }
    if (!state.session_id) throw new Error("该任务尚未创建 Codex session。");
    if (this.store.isExecutionLocked(key))
      throw new Error("原 CLI 仍持有任务锁，不能并发接管。");
    this.store.claim(key);
    await this.client.connect();
    this.assertOpen();
    const before = await this.client.request("thread/read", {
      threadId: state.session_id,
      includeTurns: false,
    });
    this.assertOpen();
    if (before.thread.status.type === "active")
      throw new Error("该 session 正在另一个客户端执行，请等待该轮结束。");
    const selection = this.settings.read(key, state).selection;
    await assertPermissionAvailable(this.client, selection.permissionMode);
    this.assertOpen();
    await this.client.request("thread/resume", {
      threadId: state.session_id,
      cwd: state.worktree.path,
      ...threadPermissionParams(selection.permissionMode),
      excludeTurns: true,
      ...(selection.model ? { model: selection.model } : {}),
    });
    this.assertOpen();
    runtime.connected = true;
    runtime.turnId = null;
    runtime.status = "idle";
    this.publish(runtime, { type: "state" });
    return runtime;
  }

  async send(key, message) {
    if (
      typeof message !== "string" ||
      !message.trim() ||
      message.length > 60000
    )
      throw new Error("消息需为 1–60000 个字符。");
    return this.exclusive(key, async () => {
      const runtime = await this.attach(key);
      this.assertOpen();
      if (runtime.requests.size)
        throw new Error("请先处理当前等待中的问题或审批。");
      const input = [{ type: "text", text: message.trim(), text_elements: [] }];
      const activeTurn = runtime.turnId;
      if (activeTurn) {
        await this.client.request("turn/steer", {
          threadId: runtime.sessionId,
          expectedTurnId: activeTurn,
          input,
        });
        this.publish(runtime, {
          type: "notice",
          text: "补充指令已发送至当前一轮。",
        });
      } else {
        let result;
        const state = this.store.read(key);
        const selection = this.settings.read(key, state).selection;
        try {
          await assertPermissionAvailable(
            this.client,
            selection.permissionMode,
          );
          this.assertOpen();
          const model = await resolveTurnModel(
            this.client,
            selection,
            state.worktree.path,
          );
          this.assertOpen();
          this.settings.starting(key, selection);
          result = await this.client.request("turn/start", {
            threadId: runtime.sessionId,
            input,
            ...model,
            ...turnPermissionParams(
              selection.permissionMode,
              state.worktree.path,
            ),
          });
          this.settings.applied(key, selection);
        } catch (error) {
          runtime.connected = false;
          runtime.status = "disconnected";
          this.publish(runtime, { type: "state", error: error.message });
          throw error;
        }
        if (
          result.turn.status === "inProgress" &&
          !runtime.completedTurns.has(result.turn.id)
        ) {
          runtime.turnId = result.turn.id;
          runtime.status = "running";
        }
        this.publish(runtime, { type: "state" });
      }
      return { sessionId: runtime.sessionId, turnId: runtime.turnId };
    });
  }

  async interrupt(key) {
    return this.exclusive(key, async () => {
      const runtime = this.sessions.get(key);
      if (runtime?.status === "initializing" && runtime.prepareAbort) {
        runtime.prepareAbort.abort();
        this.publish(runtime, {
          type: "notice",
          text: "已请求停止 worktree 初始化。",
        });
        return { accepted: true };
      }
      if (!runtime?.connected || !runtime.turnId)
        throw new Error("没有可中断的网页执行轮次。");
      await this.client.request("turn/interrupt", {
        threadId: runtime.sessionId,
        turnId: runtime.turnId,
      });
      this.publish(runtime, {
        type: "notice",
        text: "已请求停止当前一轮，等待 Codex 确认。",
      });
      return { accepted: true };
    });
  }

  async start(input) {
    this.assertOpen();
    validateTaskMetadata(input.metadata === undefined ? {} : input.metadata);
    const channel = this.channels.get(input.channel || "tapd");
    const selection = await validateModelSelection(this.client, input);
    this.assertOpen();
    const permissionMode = validatePermissionMode(input.permissionMode);
    await assertPermissionAvailable(this.client, permissionMode);
    this.assertOpen();
    const sourceInput = { ...input };
    delete sourceInput.model;
    delete sourceInput.reasoningEffort;
    delete sourceInput.permissionMode;
    delete sourceInput.metadata;
    const resolved = await channel.resolve(sourceInput);
    this.assertOpen();
    const source = sourceFor(channel.id, resolved.item);
    const key = runKey(source);
    return this.launch(
      key,
      resolved.item,
      {
        ...resolved.config,
        codex: {
          ...resolved.config.codex,
          ...selection,
          permission_mode: permissionMode,
        },
      },
      resolved.session,
      {},
      channel,
      validateTaskMetadata(
        input.metadata || {},
        defaultTaskMetadata(resolved.item),
      ),
    );
  }

  launch(
    key,
    item,
    config,
    session,
    _fields,
    channel = this.channels.get("tapd"),
    metadata = defaultTaskMetadata(item),
  ) {
    this.assertOpen();
    metadata = validateTaskMetadata(metadata);
    config = executionConfig(config, this.configFile);
    const source = sourceFor(channel.id, item);
    if (this.sessions.has(key) || this.store.hasRun(key))
      throw new Error("该需求已有运行记录。");
    // Resolve before creating run ownership, downloading images or creating a branch.
    this.client.validateCommand?.();
    this.store.claim(key);
    this.store.writeTaskMetadata(key, metadata, item);
    this.settings.initialize(key, config.codex);
    const runtime = this.runtime(key);
    runtime.pipelineActive = true;
    runtime.prepareAbort = new AbortController();
    runtime.status = "preparing";
    runtime.connected = false;
    const directory = this.store.dir(key);
    this.store.writeWeb(key, { source });
    this.publish(runtime, { type: "state", title: "正在抓取需求并准备工作区" });
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
          runtime.status = "initializing";
          if (previousStatus !== runtime.status)
            this.publish(runtime, { type: "state" });
          const item = initializationItem(
            initialization.commands[index],
            index,
          );
          runtime.items.set(item.id, item);
          this.publish(runtime, { type: "item", item });
        },
        startSession: async ({ repository, task, onSession, onStarted }) => {
          this.assertOpen();
          await this.client.connect();
          this.assertOpen();
          const selection = this.settings.read(key, {
            codex: config.codex,
          }).selection;
          await assertPermissionAvailable(
            this.client,
            selection.permissionMode,
          );
          this.assertOpen();
          const model = await resolveTurnModel(
            this.client,
            selection,
            repository,
          );
          this.assertOpen();
          const result = await this.client.request("thread/start", {
            cwd: repository,
            ...threadPermissionParams(selection.permissionMode),
            ephemeral: false,
            model: model.model,
          });
          runtime.sessionId = result.thread.id;
          runtime.status = "starting";
          runtime.connected = true;
          onSession(runtime.sessionId);
          this.assertOpen();
          this.events.persist(runtime);
          return new Promise((resolve, reject) => {
            runtime.initial = { resolve, reject, onStarted, started: false };
            runtime.initial.timer = setTimeout(() => {
              reject(
                new Error(
                  "未收到 Codex 执行开始确认，请刷新确认状态，勿重复启动。",
                ),
              );
            }, config.codex?.startup_timeout_ms || 120000);
            const input = [
              { type: "text", text: task.codex_prompt, text_elements: [] },
              ...task.images.map((image) => ({
                type: "localImage",
                path: image.path,
              })),
            ];
            this.settings.starting(key, selection);
            this.client
              .request("turn/start", {
                threadId: runtime.sessionId,
                input,
                ...model,
                ...turnPermissionParams(selection.permissionMode, repository),
              })
              .then((response) => {
                if (
                  runtime.initial &&
                  (!runtime.turnId || runtime.turnId === response.turn.id)
                )
                  this.settings.applied(key, selection);
                if (
                  runtime.initial &&
                  !runtime.turnId &&
                  response.turn.status === "inProgress"
                )
                  runtime.turnId = response.turn.id;
              })
              .catch(reject);
          });
        },
      },
    )
      .then((state) => {
        runtime.pipelineActive = false;
        runtime.prepareAbort = null;
        if (runtime.initial && !runtime.initial.started)
          runtime.connected = false;
        clearTimeout(runtime.initial?.timer);
        runtime.initial = null;
        runtime.status = state.execution.status;
        runtime.error = state.execution.error;
        this.publish(runtime, { type: "state" });
      })
      .catch((error) => {
        runtime.pipelineActive = false;
        runtime.prepareAbort = null;
        runtime.connected = false;
        clearTimeout(runtime.initial?.timer);
        runtime.initial = null;
        runtime.status = "failed";
        runtime.error = error.message;
        this.publish(runtime, { type: "error", error: error.message });
        if (!this.store.hasRun(key)) this.sessions.delete(key);
      });
    return { key, accepted: true };
  }

  list() {
    return this.views.list();
  }

  updateTaskMetadata(key, input) {
    this.assertOpen();
    const state = this.store.read(key);
    const metadata = this.store.writeTaskMetadata(key, input, state.workitem);
    this.emit("event", {
      key,
      type: "metadata",
      metadata,
      at: new Date().toISOString(),
    });
    return { metadata };
  }

  updateExecutionSettings(key, input) {
    return this.exclusive(key, () => this.settings.update(key, input));
  }

  assertOpen() {
    if (this.closing) throw new Error("会话服务正在关闭，不能继续操作。");
  }

  close() {
    if (!this.closePromise) {
      this.closing = true;
      this.closePromise = this.shutdown();
    }
    return this.closePromise;
  }

  async shutdown() {
    for (const runtime of this.sessions.values()) {
      runtime.prepareAbort?.abort();
      if (runtime.connected && runtime.turnId) {
        try {
          await this.client.request(
            "turn/interrupt",
            { threadId: runtime.sessionId, turnId: runtime.turnId },
            3000,
          );
        } catch {
          /* Preserve the session for recovery. */
        }
      }
    }
    await this.client.close();
    await Promise.allSettled(
      [
        ...this.events.pendingCallbacks,
        ...this.operations.values(),
        ...[...this.sessions.values()].map((runtime) => runtime.operation),
      ].filter(Boolean),
    );
    this.store.releaseAll();
  }
}

module.exports = { WebSessions };
