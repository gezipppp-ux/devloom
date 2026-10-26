const { EventEmitter } = require("node:events");
const { presentError } = require("./error-presenter.cjs");
const { createAgent, getAgentProvider } = require("../agents/registry.cjs");
const { AgentSessionManager } = require("./agent-session-manager.cjs");
const { agentConfig: readAgentConfig, taskPrompt } = require("../domain/agent-config.cjs");
const { isBlockingRequest, assertCapability, assertAgentIdentity } = require("../domain/agent-contract.cjs");
const { RunStore } = require("../storage/run-store.cjs");
const { initializationItem } = require("../domain/session-item.cjs");
const { validateSessionMessage } = require("../domain/session-message.cjs");
const {
  worktreeReason: defaultWorktreeReason,
} = require("../git/worktree-access.cjs");
const { SessionEvents } = require("./session-events.cjs");
const { SessionViews } = require("./session-views.cjs");
const { SessionSettings } = require("./session-settings.cjs");
const { SessionGit } = require("./session-git.cjs");
const { SessionFiles } = require("./session-files.cjs");
const { SessionPreviews } = require("./session-previews.cjs");
const { SessionRequirements } = require("./session-requirements.cjs");
const { runExecution } = require("../execution/runner.cjs");
const { defaultChannels } = require("../channels/channel-registry.cjs");
const { executionConfig } = require("../config/execution-settings.cjs");
const { validateBaseBranch } = require("../domain/development-baseline.cjs");

const { sourceFor, runKey } = require("../domain/run-identity.cjs");

class SessionManager extends EventEmitter {
  constructor({
    runsDirectory,
    configFile,
    agentConfig = { provider: "codex", options: {} },
    agent,
    supplierStore,
    workspaceId,
    store,
    run = runExecution,
    channels,
    gitCredentialProvider,
    gitCredentialRevision,
    gitOperationCredentials,
    authorize = async () => {},
    authorizeRun = async () => {},
    onExecutionEvent = async () => {},
    deleteSessionRecords = (_key, remove) => remove(),
    worktreeReason = defaultWorktreeReason,
    apiPrefix = "/api",
  }) {
    super();
    this.configFile = configFile;
    this.authorize = authorize;
    this.authorizeRun = authorizeRun;
    this.deleteSessionRecords = deleteSessionRecords;
    this.gitOperationCredentials = gitOperationCredentials;
    /** @type {RunStore} */
    this.store = store || new RunStore(runsDirectory);
    this.agent = agent || (supplierStore ? new AgentSessionManager({
      store: supplierStore, workspaceId, config: agentConfig.options,
      provider: getAgentProvider(agentConfig.provider),
      gitCredentialProvider, gitCredentialRevision,
      idle: key => {
        const runtime = this.sessions.get(key);
        return !this.operations.has(key) && !this.events.incoming.has(key) &&
          !runtime?.pipelineActive && !runtime?.turnId && !runtime?.requests.size;
      },
    }) : createAgent({
      provider: agentConfig.provider, config: agentConfig.options,
      gitCredentialProvider, gitCredentialRevision,
    }));
    this.channels = channels || defaultChannels(configFile);
    this.run = run;
    this.sessions = new Map();
    this.operations = new Map();
    this.startingRequests = 0;
    this.starts = new Set();
    this.credentialRefresh = null;
    this.closing = false;
    this.worktreeReason = worktreeReason;
    this.git = new SessionGit(this);
    this.files = new SessionFiles(this);
    this.previews = new SessionPreviews(this);
    this.requirements = new SessionRequirements(this);
    this.settings = new SessionSettings({
      store: this.store,
      agent: this.agent,
      sessions: this.sessions,
      worktreeReason: (state) => this.worktreeReason(state),
      emit: (event) => this.emit("event", event),
      assertOpen: () => this.assertOpen(),
      authorize: () => this.authorize("session.continue"),
    });
    this.events = new SessionEvents({
      store: this.store,
      agent: this.agent,
      sessions: this.sessions,
      settings: this.settings,
      apiPrefix,
      emit: (event) => this.emit("event", event),
      onExecutionEvent,
      synchronizeHistory: async (key) => (await this.views.synchronizeHistory(key)),
    });
    this.views = new SessionViews({
      store: this.store,
      agent: this.agent,
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

  async publish(runtime, event) {
    (await this.events.publish(runtime, event));
  }

  async respond(key, requestId, response) {
    return this.exclusive(key, async () => {
      await this.authorize("session.approve");
      await this.authorizeRun(key);
      assertAgentIdentity(this.agent, await this.store.read(key));
      return this.events.respond(key, requestId, response);
    });
  }

  async history(key, cursor) {
    return (await this.views.history(key, cursor));
  }

  async readGit(key) {
    return (await this.git.read(key));
  }

  async listFiles(key, scope) {
    return (await this.files.list(key, scope));
  }

  async readFile(key, file, scope) {
    return (await this.files.read(key, file, scope));
  }

  async deleteWorktree(key, input) {
    return (await this.git.remove(key, input));
  }

  async view(key) {
    return (await this.views.view(key));
  }

  async pendingRequests() {
    return await this.views.pendingRequests();
  }

  async exclusive(key, operation) {
    this.assertOpen();
    if (this.operations.has(key))
      throw new Error("该任务的上一条操作尚未完成。");
    const pending = Promise.resolve()
      .then(async () => {
        await this.credentialRefresh;
        this.assertOpen();
        return this.agent.withSession ? this.agent.withSession(key, operation) : operation();
      })
      .finally(() => this.operations.delete(key));
    this.operations.set(key, pending);
    return pending;
  }

  async attach(key) {
    this.assertOpen();
    const state = (await this.store.read(key));
    assertAgentIdentity(this.agent, state);
    assertCapability(this.agent, "resume");
    (await this.assertWorktreeRetained(key));
    const reason = this.worktreeReason(state);
    if (reason) throw new Error(reason);
    const runtime = this.runtime(key, state.session_id);
    // A credential refresh can return before its disconnect event is saved.
    // Fence this session before trusting connected or resuming its transport.
    await this.events.drain(key);
    this.assertOpen();
    if (["preparing", "initializing", "starting"].includes(runtime.status))
      throw new Error("正在准备会话，请稍候。");
    if (runtime.connected) {
      if (!runtime.turnId && runtime.pipelineActive)
        throw new Error("正在完成首轮记录，请稍候再发送。");
      return runtime;
    }
    if (!state.session_id) throw new Error("该任务尚未创建执行器会话。");
    if (this.store.isExecutionLocked(key))
      throw new Error("原 CLI 仍持有任务锁，不能并发接管。");
    this.store.claim(key);
    await this.agent.connect();
    this.assertOpen();
    const before = await this.agent.readSession(state.session_id);
    this.assertOpen();
    if (before.status !== "idle")
      throw new Error("该 session 正在另一个客户端执行，请等待该轮结束。");
    const selection = (await this.settings.read(key, state)).selection;
    await this.agent.assertPermissionAvailable(selection.permissionMode);
    this.assertOpen();
    await this.agent.resumeSession({
      sessionId: state.session_id, cwd: state.worktree.path, selection,
    });
    this.assertOpen();
    runtime.connected = true;
    try { await this.views.synchronizeHistory(key); }
    catch (error) { runtime.error = `历史补齐失败：${presentError(error).message}`; }
    runtime.turnId = null;
    runtime.status = "idle";
    (await this.publish(runtime, { type: "state" }));
    return runtime;
  }

  async send(key, message, images, preview) {
    const validated = validateSessionMessage(message, images);
    if (validated.images.length) assertCapability(this.agent, "images");
    await this.authorize("session.continue");
    assertAgentIdentity(this.agent, await this.store.read(key));
    (await this.refreshGitCredentials());
    return (await this.exclusive(key, async () => {
      if (preview !== undefined) await this.previews.writable(key);
      const feedback = preview === undefined ? "" : await this.previews.feedback(key, preview);
      if (feedback) validateSessionMessage(validated.text + feedback, validated.images);
      const attachments = (await Promise.all(validated.images.map(async (id) =>
        (await (await this.store.messageImages(key)).read(id)),
      )));
      const input = [
        ...(validated.text || feedback
          ? [{ type: "text", text: validated.text + feedback }]
          : []),
        ...attachments.map((image) => ({
          type: "image",
          path: image.path,
        })),
      ];
      return (await this.sendInput(key, input));
    }));
  }

  // Caller holds the session operation lock. A dispatch hook persists addition
  // intent immediately before RPC so unknown outcomes are never replayed.
  async sendInput(key, input, beforeDispatch) {
    await this.authorizeRun(key, beforeDispatch ? "append" : "continue");
    if (input.some(part => part.type === "image")) assertCapability(this.agent, "images");
    let dispatchedTurnId;
    const runtime = await this.attach(key);
    this.assertOpen();
    if ([...runtime.requests.values()].some(isBlockingRequest))
      throw new Error("请先处理当前等待中的问题或审批。");
    const activeTurn = runtime.turnId;
    if (activeTurn) {
      if (beforeDispatch) throw new Error("请等待当前轮结束后处理新增需求。");
      await this.authorize("session.continue");
      assertCapability(this.agent, "steer");
      await this.agent.steerTurn({
        sessionId: runtime.sessionId,
        turnId: activeTurn,
        input,
      });
      (await this.publish(runtime, {
        type: "notice",
        text: "补充指令已发送至当前一轮。",
      }));
    } else {
      let result;
      let dispatched = false;
      const state = (await this.store.read(key));
      const selection = (await this.settings.read(key, state)).selection;
      try {
        if (this.agent.prepare) {
          await this.events.settle(key);
          const binding = await this.agent.prepare(key, runtime);
          runtime.supplier = binding.supplier;
          if (binding.replaced) { runtime.connected = false; await this.attach(key); }
        }
        await this.agent.assertPermissionAvailable(selection.permissionMode);
        this.assertOpen();
        const prepared = await this.agent.prepareTurn(selection, state.worktree.path);
        this.assertOpen();
        this.settings.starting(key, runtime.supplier ? prepared : selection, selection);
        await this.authorize("session.continue");
        runtime.executionPermission = "session.continue";
        await beforeDispatch?.();
        await this.authorize("session.continue");
        await this.authorizeRun(key, "dispatch");
        dispatched = true;
        result = await this.agent.startTurn({
          sessionId: runtime.sessionId, input, cwd: state.worktree.path, selection: prepared,
        });
        dispatchedTurnId = result.id;
        (await this.settings.applied(key, runtime.supplier ? prepared : selection));
      } catch (error) {
        await this.agent.cancelPreparation?.(key);
        if (dispatched) await this.events.enqueue(key, async () => {
          const current = await this.store.read(key);
          if (!runtime.turnId && current.execution?.status === "starting") await this.store.update(key, { execution: { status: "unknown", error: presentError(error).message } });
        });
        runtime.connected = false;
        runtime.status = "disconnected";
        (await this.publish(runtime, { type: "state", error: presentError(error).message }));
        throw error;
      }
      if (
        result.status === "running" &&
        !runtime.completedTurns.has(result.id)
      ) {
        runtime.turnId = result.id;
        runtime.status = "running";
      }
      (await this.publish(runtime, { type: "state" }));
    }
    return { sessionId: runtime.sessionId, turnId: runtime.turnId,
      ...(beforeDispatch ? { dispatchedTurnId } : {}) };
  }

  async uploadMessageImage(key, bytes) {
    assertCapability(this.agent, "images");
    return (await this.exclusive(key, async () => {
      const state = (await this.store.read(key));
      assertAgentIdentity(this.agent, state);
      (await this.assertWorktreeRetained(key));
      const reason = this.worktreeReason(state);
      if (reason) throw new Error(reason);
      const runtime = this.sessions.get(key);
      if (
        !state.session_id ||
        ["preparing", "initializing", "starting"].includes(runtime?.status)
      )
        throw new Error("正在准备会话，请稍候再上传图片。");
      if (runtime && [...runtime.requests.values()].some(isBlockingRequest))
        throw new Error("请先处理当前等待中的问题或审批。");
      if (this.store.isExecutionLocked(key) && !runtime?.initial)
        throw new Error("原 CLI 仍持有任务锁，不能上传会话图片。");
      this.store.claim(key);
      await this.authorize("session.continue");
      const image = (await (await this.store.messageImages(key)).save(bytes));
      return this.views.presenter.messageImage(key, image);
    }));
  }

  async messageImagePath(key, id) {
    return (await (await this.store.messageImages(key)).read(id)).path;
  }

  async interrupt(key) {
    return (await this.exclusive(key, async () => {
      await this.authorize("session.stop");
      assertAgentIdentity(this.agent, await this.store.read(key));
      const runtime = this.sessions.get(key);
      if (runtime?.status === "initializing" && runtime.prepareAbort) {
        runtime.prepareAbort.abort();
        (await this.publish(runtime, {
          type: "notice",
          text: "已请求停止 worktree 初始化。",
        }));
        return { accepted: true };
      }
      if (!runtime?.connected || !runtime.turnId)
        throw new Error("没有可中断的网页执行轮次。");
      await this.agent.interruptTurn({
        sessionId: runtime.sessionId,
        turnId: runtime.turnId,
      });
      (await this.publish(runtime, {
        type: "notice",
        text: "已请求停止当前一轮，等待执行器确认。",
      }));
      return { accepted: true };
    }));
  }

  trackStart(operation) {
    const pending = Promise.resolve().then(() => {
      this.assertOpen();
      return operation();
    });
    this.starts.add(pending);
    void pending.finally(() => this.starts.delete(pending)).catch(() => {});
    return pending;
  }

  start(input) {
    return this.trackStart(() => this.startRequest(input));
  }

  async startRequest(input) {
    await this.authorize("session.start");
    const refresh = this.refreshGitCredentials();
    this.startingRequests++;
    try {
      await refresh;
      return await this.resolveAndLaunch(input);
    } finally {
      this.startingRequests--;
    }
  }

  async validateStartSelection(input) {
    this.assertOpen();
    const selection = await this.agent.validateSelection(input);
    this.assertOpen();
    await this.agent.assertPermissionAvailable(selection.permissionMode);
    this.assertOpen();
    return selection;
  }

  async resolveAndLaunch(input) {
    this.assertOpen();
    const channel = this.channels.get(input.channel || "manual");
    const selection = await this.validateStartSelection(input);
    const sourceInput = { ...input };
    delete sourceInput.model;
    delete sourceInput.reasoningEffort;
    delete sourceInput.permissionMode;
    delete sourceInput.baseBranch;
    const baseBranch = input.baseBranch === undefined ? undefined : validateBaseBranch(input.baseBranch);
    const resolved = await channel.resolve(sourceInput);
    this.assertOpen();
    const source = sourceFor(channel.id, resolved.item);
    const key = runKey(source);
    return (await this.launch(
      key,
      resolved.item,
      {
        ...resolved.config,
        agent: { ...readAgentConfig(resolved.config), ...selection },
      },
      resolved.session,
      { baseBranch },
      channel,
    ));
  }

  launch(key, ...args) {
    return this.trackStart(async () => {
      // Refresh before reserving the key: active operations intentionally fence
      // credential rotation. Only preparation is exclusive, not the live turn.
      await this.refreshGitCredentials();
      return this.exclusive(key, () => this.prepareLaunch(key, ...args));
    });
  }

  async prepareLaunch(
    key,
    item,
    config,
    session,
    executionSelection = {},
    channel = this.channels.get("manual"),
  ) {
    this.assertOpen();
    config = (await executionConfig(config, this.configFile, executionSelection));
    assertAgentIdentity(this.agent, config);
    const source = sourceFor(channel.id, item);
    if (this.sessions.has(key) || (await this.store.hasRun(key))) {
      if (item.request_fingerprint && (await this.store.requirements.read(key)).fingerprint === item.request_fingerprint)
        return { key, accepted: true, reused: true };
      throw new Error("该需求已有运行记录。");
    }
    // Resolve before creating run ownership, downloading images or creating a branch.
    await this.authorize("session.start");
    await this.authorizeRun(key, "start");
    this.assertOpen();
    this.agent.validateCommand();
    this.store.claim(key);
    let claimed = false;
    let runtime;
    try {
      const binding = await this.agent.prepare?.(key);
      runtime = this.runtime(key);
      runtime.supplier = binding?.supplier;
      (await this.store.requirements.claim(key, item.sources || [source], { fingerprint: item.request_fingerprint }));
      claimed = true;
      this.assertOpen();
      (await this.settings.initialize(key, config.agent));
      this.assertOpen();
      runtime = this.runtime(key);
      runtime.pipelineActive = true;
      runtime.executionPermission = "session.start";
      runtime.prepareAbort = new AbortController();
      runtime.status = "preparing";
      runtime.connected = false;
      const directory = this.store.dir(key);
      (await this.store.writeWeb(key, { source }));
      this.assertOpen();
      (await this.publish(runtime, { type: "state", title: "正在抓取需求并准备工作区" }));
      this.assertOpen();
      const gitCredentials = await this.gitOperationCredentials?.(config);
      await this.authorize("session.start");
      await this.authorizeRun(key, "start");
      this.assertOpen();
      runtime.operation = this.run(
        {
          config,
          baseBranch: config.execution.baseBranch,
          channel,
          configFile: this.configFile,
          session,
          item,
          directory,
        },
        {
          signal: runtime.prepareAbort.signal,
          gitCredentials,
          authorize: async () => {
            this.assertOpen();
            await this.authorize("session.start");
            await this.authorizeRun(key, "start");
            this.assertOpen();
          },
          onInitialization: async (initialization, index) => {
            const previousStatus = runtime.status;
            runtime.status = "initializing";
            if (previousStatus !== runtime.status)
              (await this.publish(runtime, { type: "state" }));
            const item = initializationItem(
              initialization.commands[index],
              index,
            );
            runtime.items.set(item.id, item);
            (await this.publish(runtime, { type: "item", item }));
          },
          startSession: async ({ repository, task, onSession, onStarted }) => {
            this.assertOpen();
            await this.authorize("session.start");
            await this.authorizeRun(key, "start");
            this.assertOpen();
            await this.agent.connect();
            this.assertOpen();
            const selection = (await this.settings.read(key, {
              agent: config.agent,
            })).selection;
            await this.agent.assertPermissionAvailable(selection.permissionMode);
            this.assertOpen();
            const prepared = await this.agent.prepareTurn(selection, repository);
            this.assertOpen();
            await this.authorize("session.start");
            await this.authorizeRun(key, "start");
            this.assertOpen();
            if (task.images.length) assertCapability(this.agent, "images");
            const result = await this.agent.createSession({ cwd: repository, selection: prepared });
            runtime.sessionId = result.sessionId;
            runtime.status = "starting";
            runtime.connected = true;
            await onSession(runtime.sessionId);
            this.assertOpen();
            await this.authorize("session.start");
            await this.authorizeRun(key, "start");
            (await this.events.persist(runtime));
            await this.authorize("session.start");
            await this.authorizeRun(key, "start-dispatch");
            this.assertOpen();
            return new Promise((resolve, reject) => {
              const initial = { resolve, reject, onStarted, started: false };
              runtime.initial = initial;
              runtime.initial.timer = setTimeout(() => {
                reject(
                  new Error(
                    "未收到执行器的执行开始确认，请刷新确认状态，勿重复启动。",
                  ),
                );
              }, config.agent.startupTimeoutMs);
              const input = [
                { type: "text", text: taskPrompt(task) },
                ...task.images.map((image) => ({
                  type: "image",
                  path: image.path,
                })),
              ];
              this.settings.starting(key, runtime.supplier ? prepared : selection, selection);
              this.agent
                .startTurn({
                  sessionId: runtime.sessionId, input, cwd: repository, selection: prepared,
                })
                .then((response) => this.events.enqueue(key, async () => {
                  if (
                    runtime.initial !== initial ||
                    runtime.completedTurns.has(response.id)
                  )
                    return;
                  if (
                    !runtime.turnId || runtime.turnId === response.id
                  )
                    (await this.settings.applied(key, runtime.supplier ? prepared : selection));
                  if (
                    !runtime.turnId &&
                    response.status === "running"
                  )
                    runtime.turnId = response.id;
                }))
                .catch(reject);
            });
          },
        },
      )
        .then(async (state) => {
          await this.agent.cancelPreparation?.(key);
          runtime.pipelineActive = false;
          runtime.prepareAbort = null;
          if (runtime.initial && !runtime.initial.started)
            runtime.connected = false;
          clearTimeout(runtime.initial?.timer);
          runtime.initial = null;
          runtime.status = state.execution.status;
          runtime.error = state.execution.error;
          (await this.publish(runtime, { type: "state" }));
        })
        .catch(async (error) => {
          await this.agent.cancelPreparation?.(key);
          error = presentError(error);
          runtime.pipelineActive = false;
          runtime.prepareAbort = null;
          runtime.connected = false;
          clearTimeout(runtime.initial?.timer);
          runtime.initial = null;
          runtime.status = "failed";
          runtime.error = error.message;
          (await this.publish(runtime, { type: "error", error: error.message }));
          if (!(await this.store.hasRun(key))) {
            (await this.store.requirements.releaseUnstarted(key));
            this.sessions.delete(key);
          }
        });
      // The accepted background operation must remain observed even when its
      // failure cannot itself be persisted.
      void runtime.operation.catch(error => this.events.fail(runtime, error));
      return { key, accepted: true };
    } catch (error) {
      try {
        await this.agent.cancelPreparation?.(key);
        if (claimed) await this.store.requirements.releaseUnstarted(key);
        if (runtime && !(await this.store.hasRun(key))) this.sessions.delete(key);
      } finally {
        this.store.release(key);
      }
      throw error;
    }
  }

  async list(options) {
    return (await this.views.list(options));
  }

  async updateTitle(key, title) {
    return this.exclusive(key, async () => {
      (await this.store.read(key));
      const savedTitle = (await this.store.writeSessionTitle(key, title));
      this.emit("event", {
        key,
        type: "title",
        title: savedTitle,
        at: new Date().toISOString(),
      });
      return { title: savedTitle };
    });
  }

  async archive(key) {
    return (await this.exclusive(key, async () => {
      (await this.store.read(key));
      const reason = this.git.activeReason(key);
      if (reason) throw new Error(reason.replace("删除 Worktree", "归档会话"));
      const archive = (await this.store.archive(key));
      this.emit("event", {
        key,
        type: "archived",
        ...archive,
        at: new Date().toISOString(),
      });
      return archive;
    }));
  }

  async restore(key) {
    return (await this.exclusive(key, async () => {
      (await this.store.read(key));
      const restored = (await this.store.restore(key));
      this.emit("event", { key, type: "restored", ...restored, at: new Date().toISOString() });
      return restored;
    }));
  }

  async deleteSession(key, input) {
    return (await this.exclusive(key, async () => {
      if (
        !input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((field) => !["confirm", "force", "confirmBranch"].includes(field)) ||
        (input.force !== undefined && typeof input.force !== "boolean") ||
        (input.confirmBranch !== undefined && typeof input.confirmBranch !== "string") ||
        input.confirm !== true
      ) throw new Error("请明确确认永久删除会话。");
      await this.authorizeRun(key, "delete");
      const state = (await this.store.read(key));
      const reason = this.git.activeReason(key);
      if (reason) throw new Error(reason.replace("删除 Worktree", "删除会话"));
      this.store.claim(key);
      const runtime = this.sessions.get(key);
      // Stop accepting late notifications before waiting for existing writes.
      if (runtime) runtime.deleting = true;
      try {
        await this.events.settle(key);
        await runtime?.operation;
        this.assertOpen();
        if (input.force) await this.git.forceRemove(key, input.confirmBranch);
        await this.events.settle(key);
        const afterCleanup = this.git.activeReason(key);
        if (afterCleanup) throw new Error(afterCleanup);
        const deletion = (await this.store.readWorktreeDeletion(key));
        if (state.worktree?.path && deletion.status !== "deleted")
          throw new Error("请先删除 Worktree 与本地分支，避免遗留无法管理的代码目录。");
        await this.deleteSessionRecords(key, beforeDelete => this.store.deleteRun(key, beforeDelete));
        await this.agent.forget?.(key);
        this.sessions.delete(key);
        this.emit("event", { key, type: "deleted", at: new Date().toISOString() });
        return { deleted: true };
      } finally {
        if (runtime) runtime.deleting = false;
      }
    }));
  }

  async updateExecutionSettings(key, input) {
    return (await this.exclusive(key, async () => {
      (await this.assertWorktreeRetained(key));
      return (await this.settings.update(key, input));
    }));
  }

  async assertWorktreeRetained(key) {
    const deletion = (await this.store.readWorktreeDeletion(key));
    if (deletion.worktreeRemoved || deletion.status === "deleted")
      throw new Error("Worktree 已删除，此会话仅供查看。");
    if (deletion.status === "deleting")
      throw new Error("Worktree 删除操作尚未完成，请在 Git 面板中检查。");
  }

  assertOpen() {
    if (this.closing) throw new Error("会话服务正在关闭，不能继续操作。");
  }

  async refreshGitCredentials() {
    this.assertOpen();
    if (this.credentialRefresh) return this.credentialRefresh;
    if (this.operations.size || this.startingRequests ||
      [...this.sessions.values()].some(runtime =>
        runtime.pipelineActive || runtime.turnId || runtime.requests.size ||
        ["preparing", "initializing", "starting", "running"].includes(runtime.status),
      )) return;
    const pending = Promise.resolve().then(() => this.agent.refreshGitCredentials());
    this.credentialRefresh = pending;
    try { await pending; }
    finally { if (this.credentialRefresh === pending) this.credentialRefresh = null; }
  }

  async revokeAccess(key) {
    for (const runtime of this.sessions.values()) {
      if (key && runtime.key !== key) continue;
      runtime.prepareAbort?.abort();
      if (runtime.connected && runtime.turnId && runtime.revocationTurn !== runtime.turnId) {
        const turnId = runtime.turnId;
        try {
          await this.agent.interruptTurn({ sessionId: runtime.sessionId, turnId }, 3000);
          runtime.revocationTurn = turnId;
          await this.publish(runtime, { type: "notice", text: "项目权限已变更，已请求停止本轮，等待执行器确认。" });
        } catch (error) { this.events.fail(runtime, error); }
      }
    }
  }

  close() {
    if (!this.closePromise) {
      this.closing = true;
      this.closePromise = this.shutdown();
    }
    return this.closePromise;
  }

  async shutdown() {
    await this.credentialRefresh?.catch(() => {});
    for (const runtime of this.sessions.values()) {
      runtime.prepareAbort?.abort();
      if (runtime.connected && runtime.turnId) {
        try {
          await this.agent.interruptTurn(
            { sessionId: runtime.sessionId, turnId: runtime.turnId },
            3000,
          );
        } catch {
          /* Preserve the session for recovery. */
        }
      }
      // A completion may be waiting for an onStarted callback in the event
      // queue. Reject the pipeline before disconnect queues behind it.
      clearTimeout(runtime.initial?.timer);
      runtime.initial?.reject(new Error("会话服务正在关闭。"));
      runtime.initial = null;
    }
    await this.agent.close();
    await Promise.allSettled([...this.starts]);
    await this.events.drain();
    for (const runtime of this.sessions.values()) (await this.events.flushHistory(runtime.key));
    await Promise.allSettled(
      [
        ...this.events.pendingCallbacks,
        ...[...this.events.completions.values()].flatMap((pending) => [...pending]),
        ...this.operations.values(),
        ...[...this.sessions.values()].map((runtime) => runtime.operation),
      ].filter(Boolean),
    );
    this.store.releaseAll();
  }
}

module.exports = { SessionManager };
