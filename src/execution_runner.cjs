const fs = require("node:fs");
const path = require("node:path");
const {
  createWorktree,
  repositoryFor,
  worktreePlan,
} = require("./git_worktree.cjs");
const { startSession } = require("./codex_session.cjs");
const { executionConfig } = require("./settings.cjs");
const { sourceFor, runKey } = require("./run_identity.cjs");
const { initializeWorktree } = require("./worktree_init.cjs");

function saveState(file, state) {
  state.updated_at = new Date().toISOString();
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

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
  config = executionConfig(config, configFile);
  const source = sourceFor(channel.id, item);
  fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, ".lock");
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `This requirement is locked: ${lock}. Check whether its runner is still active.`,
      );
    throw error;
  }
  const file = path.join(directory, "run.json");
  let state;
  async function transition() {
    state.transition = { status: "pending" };
    saveState(file, state);
    try {
      const result = await channel.transition({ session, state, config });
      state.transition = { status: "succeeded", ...result };
    } catch (error) {
      state.transition = { status: "failed", error: error.message };
    }
    saveState(file, state);
  }
  try {
    if (fs.existsSync(file)) {
      state = JSON.parse(fs.readFileSync(file, "utf8"));
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
    fs.writeFileSync(
      path.join(directory, "requirement.json"),
      JSON.stringify(task, null, 2),
      { mode: 0o600 },
    );
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
      },
      execution: { status: "preparing" },
      transition: { status: "not_started" },
      image_count: task.images.length,
    };
    // Persist intent before any external side effect; an uncertain run is never redispatched.
    saveState(file, state);
    if (dependencies.signal?.aborted) throw new Error("任务准备已停止。");
    services.createWorktree(worktree);
    if (config.codex.init_commands.length) {
      state.execution = { status: "initializing" };
      saveState(file, state);
      await services.initializeWorktree({
        commands: config.codex.init_commands,
        cwd: worktree.path,
        directory,
        signal: dependencies.signal,
        onUpdate(initialization, index) {
          state.initialization = initialization;
          saveState(file, state);
          dependencies.onInitialization?.(initialization, index);
        },
      });
    }
    if (dependencies.signal?.aborted) throw new Error("任务准备已停止。");
    state.execution = { status: "starting" };
    saveState(file, state);
    try {
      const execution = await services.startSession({
        config: config.codex || {},
        repository: worktree.path,
        directory,
        task,
        onSession(sessionId) {
          state.session_id = sessionId;
          saveState(file, state);
          process.stderr.write(
            `Codex session: ${sessionId}\nWorktree: ${worktree.path}\n`,
          );
        },
        async onStarted() {
          state.execution_started_at = new Date().toISOString();
          state.execution = { status: "running" };
          saveState(file, state);
          await transition();
          process.stderr.write(
            `Channel transition: ${state.transition.status}\n`,
          );
        },
      });
      state.execution = {
        status: execution.completed ? "completed" : "failed",
        ...execution,
      };
    } catch (error) {
      state.execution = { status: "failed", error: error.message };
    }
    saveState(file, state);
    return state;
  } catch (error) {
    if (
      state &&
      !retry &&
      ["preparing", "initializing"].includes(state.execution.status)
    ) {
      state.execution = { status: "failed", error: error.message };
      saveState(file, state);
    }
    throw error;
  } finally {
    fs.rmdirSync(lock);
  }
}

module.exports = { runExecution, saveState };
