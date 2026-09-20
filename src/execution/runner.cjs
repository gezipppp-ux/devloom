const path = require("node:path");
const { createWorktree, worktreePlan } = require("../git/worktrees.cjs");
const { repositoryFor } = require("../config/repository.cjs");
const { startSession } = require("../codex/cli-session.cjs");
const { executionConfig } = require("../config/execution-settings.cjs");
const { assertWorktreeLocation, assertMemberWorktreeLocation } = require("../config/worktree-location.cjs");
const { sourceFor, runKey } = require("../domain/run-identity.cjs");
const { initializeWorktree } = require("./worktree-init.cjs");
const { ExecutionStore } = require("../storage/execution-store.cjs");

async function runExecution(
  { config, configFile, session, item, directory, channel, retry = false },
  dependencies = {},
) {
  const services = {
    repositoryFor,
    worktreePlan,
    createWorktree,
    startSession,
    initializeWorktree,
    ...dependencies,
  };
  const source = sourceFor(channel.id, item);
  const store = new ExecutionStore(directory);
  store.lock();
  let state;
  async function transition() {
    state = store.update({ transition: { status: "pending" } });
    let transition;
    try {
      const result = await channel.transition({ session, state, config });
      transition = { status: "succeeded", ...result };
    } catch (error) {
      transition = { status: "failed", error: error.message };
    }
    state = store.update({ transition });
  }
  try {
    if (store.exists()) {
      state = store.read();
      if (
        (state.source?.channel || "tapd") !== channel.id ||
        String(state.workitem.id) !== String(item.id) ||
        String(state.workitem.workspace_id) !== String(item.workspace_id)
      )
        throw new Error(
          "Run identity does not match the requested requirement.",
        );
      if (!retry) return { ...state, reused: true };
      if (state.transition.status === "succeeded")
        return { ...state, reused: true };
      if (!state.session_id || !state.execution_started_at)
        throw new Error(
          "No confirmed execution start is recorded; cannot retry the channel transition.",
        );
      channel.validate?.(config);
      await transition();
      return state;
    }
    if (retry) throw new Error("No previous run exists for this requirement.");
    config = executionConfig(config, configFile);
    channel.validate?.(config);
    const repository = services.repositoryFor(
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
    if (runKey(sourceFor(channel.id, workitem)) !== runKey(source))
      throw new Error("Channel returned a different requirement identity.");
    store.writeTask(task);
    const worktree = services.worktreePlan(
      repository,
      workitem,
      config.codex?.base_ref,
      {
        root: path.resolve(
          path.dirname(configFile),
          config.codex.worktree_root,
        ),
        source,
        workspaceId: config.workspace?.id,
        slug: worktreeSlug,
        name: worktreeName,
      },
    );
    state = {
      version: 3,
      workspace_id: config.workspace?.id,
      source,
      created_at: new Date().toISOString(),
      workitem,
      worktree,
      target_status: target,
      session_id: null,
      codex: {
        model: config.codex?.model || "",
        reasoning_effort: config.codex?.reasoning_effort || "",
        permission_mode: config.codex?.permission_mode || "ask",
      },
      execution: { status: "preparing" },
      transition: { status: "not_started" },
      image_count: task.images.length,
    };
    // Persist intent before any external side effect; an uncertain run is never redispatched.
    store.save(state);
    if (dependencies.signal?.aborted) throw new Error("任务准备已停止。");
    if (config.workspace) {
      if (config.codex.worktree_member_path)
        assertMemberWorktreeLocation(config.codex.worktree_base_path, config.codex.worktree_member_path, worktree.path);
      else assertWorktreeLocation(config.codex.worktree_base_path, worktree.path);
    }
    services.createWorktree(worktree);
    if (config.codex.init_commands.length) {
      state.execution = { status: "initializing" };
      store.save(state);
      await services.initializeWorktree({
        commands: config.codex.init_commands,
        cwd: worktree.path,
        directory,
        signal: dependencies.signal,
        onUpdate(initialization, index) {
          state.initialization = initialization;
          store.save(state);
          dependencies.onInitialization?.(initialization, index);
        },
      });
    }
    if (dependencies.signal?.aborted) throw new Error("任务准备已停止。");
    state.execution = { status: "starting" };
    store.save(state);
    try {
      const execution = await services.startSession({
        config: config.codex || {},
        repository: worktree.path,
        directory,
        task,
        onEvent: (line) => store.append("events.jsonl", line),
        onStderr: (chunk) => store.append("stderr.log", chunk),
        onFinal: () => store.captureFinal(),
        onSession(sessionId) {
          state.session_id = sessionId;
          store.save(state);
          dependencies.onSession?.(sessionId, worktree);
        },
        async onStarted() {
          state.execution_started_at = new Date().toISOString();
          state.execution = { status: "running" };
          store.save(state);
          await transition();
          dependencies.onTransition?.(state.transition);
        },
      });
      state.execution = {
        status: execution.completed ? "completed" : "failed",
        ...execution,
      };
    } catch (error) {
      state.execution = { status: "failed", error: error.message };
    }
    store.save(state);
    return state;
  } catch (error) {
    if (
      state &&
      !retry &&
      ["preparing", "initializing"].includes(state.execution.status)
    ) {
      state.execution = { status: "failed", error: error.message };
      store.save(state);
    }
    throw error;
  } finally {
    store.release();
  }
}

module.exports = { runExecution };
