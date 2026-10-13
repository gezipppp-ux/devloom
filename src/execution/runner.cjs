const path = require("node:path");
const { fetchDevelopmentBaseline } = require("../git/development-baseline.cjs");
const { repositoryCommonDirectory } = require("../git/repository.cjs");
const { withRepositoryOperation } = require("../storage/git-operations.cjs");
const { createWorktree, worktreePlan } = require("../git/worktrees.cjs");
const { repositoryFor } = require("../config/repository.cjs");
const { getAgentProvider } = require("../agents/registry.cjs");
const { agentConfig, taskPrompt } = require("../domain/agent-config.cjs");
const { executionConfig } = require("../config/execution-settings.cjs");
const { assertWorktreeLocation, assertMemberWorktreeLocation } = require("../config/worktree-location.cjs");
const { sourceFor, runKey } = require("../domain/run-identity.cjs");
const { initializeWorktree } = require("./worktree-init.cjs");
const { ExecutionStore } = require("../storage/execution-store.cjs");

async function runExecution(
  { config, configFile, session, item, directory, channel, retry = false, baseBranch },
  dependencies = {},
) {
  const services = {
    repositoryFor,
    repositoryCommonDirectory,
    withRepositoryOperation,
    fetchDevelopmentBaseline,
    worktreePlan,
    createWorktree,
    initializeWorktree,
    ...dependencies,
  };
  const source = sourceFor(channel.id, item);
  const store = new ExecutionStore(directory);
  store.lock();
  let state;
  async function transition() {
    state = (await store.update({ transition: { status: "pending" } }));
    let transition;
    try {
      const result = await channel.transition({ session, state, config });
      transition = { status: "succeeded", ...result };
    } catch (error) {
      transition = { status: "failed", error: error.message };
    }
    state = (await store.update({ transition }));
  }
  try {
    if ((await store.exists())) {
      state = (await store.read());
      getAgentProvider(agentConfig(state).provider);
      if (
        runKey(state.source) !== runKey(source) ||
        String(state.workitem.id) !== String(item.id) ||
        String(state.workitem.workspace_id) !== String(item.workspace_id)
      )
        throw new Error(
          "Run identity does not match the requested requirement.",
        );
      if (!retry) return { ...state, reused: true };
      if (["succeeded", "skipped"].includes(state.transition.status))
        return { ...state, reused: true };
      if (!state.session_id || !state.execution_started_at)
        throw new Error(
          "No confirmed execution start is recorded; cannot retry the channel transition.",
        );
      await channel.validate?.(config);
      await transition();
      return state;
    }
    if (retry) throw new Error("No previous run exists for this requirement.");
    getAgentProvider(agentConfig(config).provider);
    if (typeof services.startSession !== "function")
      throw new Error("执行流程必须显式提供 Agent 会话执行接口。");
    (await store.claimSources(runKey(source), item.sources || [source], {
      fingerprint: item.request_fingerprint,
    }));
    config = (await executionConfig(config, configFile, { baseBranch }));
    await channel.validate?.(config);
    const repository = await services.repositoryFor(
      config,
      configFile,
      item.workspace_id,
      channel.id,
    );
    const { workitem, task, target, worktreeSlug, worktreeName } =
      await channel.prepare({
        session,
        item,
        directory,
        config,
      });
    if (!task.execution_ready) throw new Error(task.blocked_reason);
    if (typeof taskPrompt(task) !== "string") throw new Error("任务必须包含 prompt 文本。");
    if (runKey(sourceFor(channel.id, workitem)) !== runKey(source))
      throw new Error("Channel returned a different requirement identity.");
    (await store.writeTask(task));
    state = {
      version: 3,
      workspace_id: config.workspace?.id,
      source,
      created_at: new Date().toISOString(),
      workitem,
      worktree: { repository, baseline: { remote: "origin", branch: config.execution.baseBranch || null, commit: null, fetchedAt: null } },
      target_status: target,
      session_id: null,
      agent: {
        provider: config.agent.provider,
        model: config.agent.model,
        reasoningEffort: config.agent.reasoningEffort,
        permissionMode: config.agent.permissionMode,
      },
      execution: { status: "preparing" },
      transition: { status: "not_started" },
      image_count: task.images.length,
    };
    // Keep preparation failures readable even when no worktree could be created.
    await store.save(state);
    const worktree = await services.withRepositoryOperation(services.repositoryCommonDirectory(repository), async () => {
      const baseline = await services.fetchDevelopmentBaseline(repository, config.execution.baseBranch, {
        credentials: dependencies.gitCredentials,
        signal: dependencies.signal,
        authorize: dependencies.authorize,
      });
      const worktree = await services.worktreePlan(
        repository,
        workitem,
        baseline.commit,
        {
          root: path.resolve(
            path.dirname(configFile),
            config.execution.worktreeRoot,
          ),
          source,
          workspaceId: config.workspace?.id,
          slug: worktreeSlug,
          name: worktreeName,
        },
      );
      worktree.baseline = baseline;
      await dependencies.authorize?.();
      if (dependencies.signal?.aborted) throw new Error("任务准备已停止。");
      state.worktree = worktree;
      // Persist the fetched commit before worktree creation; uncertain runs are never redispatched.
      (await store.save(state));
      if (dependencies.signal?.aborted) throw new Error("任务准备已停止。");
      if (config.workspace) {
        if (config.execution.memberRoot)
          assertMemberWorktreeLocation(config.execution.memberStorageRoot, config.execution.memberRoot, worktree.path);
        else assertWorktreeLocation(config.execution.memberStorageRoot, worktree.path);
      }
      await dependencies.authorize?.();
      if (dependencies.signal?.aborted) throw new Error("任务准备已停止。");
      await services.createWorktree(worktree);
      return worktree;
    });
    if (config.execution.initCommands.length) {
      state.execution = { status: "initializing" };
      (await store.save(state));
      await services.initializeWorktree({
        commands: config.execution.initCommands,
        cwd: worktree.path,
        directory,
        signal: dependencies.signal,
        async onUpdate(initialization, index) {
          state.initialization = initialization;
          (await store.save(state));
          await dependencies.onInitialization?.(initialization, index);
        },
      });
    }
    if (dependencies.signal?.aborted) throw new Error("任务准备已停止。");
    await dependencies.authorize?.();
    if (dependencies.signal?.aborted) throw new Error("任务准备已停止。");
    state.execution = { status: "starting" };
    (await store.save(state));
    try {
      const execution = await services.startSession({
        agent: config.agent,
        config: config.agent.options,
        repository: worktree.path,
        directory,
        task,
        onItem: async (item) => (await store.saveHistoryItem(item)),
        onEvent: async (line) => (await store.append("events.jsonl", line)),
        onStderr: async (chunk) => (await store.append("stderr.log", chunk)),
        onFinal: async () => (await store.captureFinal()),
        async onSession(sessionId) {
          state.session_id = sessionId;
          (await store.save(state));
          await dependencies.onSession?.(sessionId, worktree);
        },
        async onStarted() {
          state.execution_started_at = new Date().toISOString();
          state.execution = { status: "running" };
          (await store.save(state));
          await transition();
          await dependencies.onTransition?.(state.transition);
        },
      });
      state.execution = {
        status: execution.completed ? "completed" : "failed",
        ...execution,
      };
    } catch (error) {
      state.execution = { status: "failed", error: error.message };
    }
    (await store.save(state));
    return state;
  } catch (error) {
    if (
      state &&
      !retry &&
      ["preparing", "initializing"].includes(state.execution.status)
    ) {
      state.execution = { status: "failed", error: error.message };
      (await store.save(state));
    }
    throw error;
  } finally {
    store.release();
    (await store.releaseUnstartedSources());
  }
}

module.exports = { runExecution };
