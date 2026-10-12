const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runExecution } = require("../../src/execution/runner.cjs");
const { temporary } = require("../support/helpers.cjs");

function fixture(t, config) {
  const root = temporary(t);
  const calls = [];
  const item = { id: "task", workspace_id: "scope", title: "neutral task" };
  const task = { prompt: "Implement the fixture", images: [], execution_ready: true };
  const input = {
    config,
    configFile: path.join(root, "config.json"),
    item,
    directory: path.join(root, "run"),
    channel: {
      id: "fixture",
      prepare: async () => { calls.push("prepare"); return { workitem: item, task }; },
      transition: async () => ({ status: "skipped" }),
    },
  };
  const dependencies = {
    repositoryFor: () => { calls.push("repository"); return root; },
    worktreePlan: () => ({ path: path.join(root, "worktree"), branch: "existing-prefix/fixture" }),
    createWorktree: () => calls.push("worktree"),
    initializeWorktree: () => calls.push("initialize"),
    startSession: async ({ agent, config: launch, task: received, onSession, onStarted }) => {
      calls.push("agent");
      assert.equal(agent.model, "selected-model");
      assert.deepEqual(launch, { command: "fixture-only" });
      assert.equal(received.prompt, task.prompt);
      await onSession("persistent-session");
      await onStarted();
      return { completed: true, exit_code: 0 };
    },
  };
  return { input, dependencies, calls };
}

test("neutral execution dispatches provider options and records selected provider without changing identities", async (t) => {
  const { input, dependencies, calls } = fixture(t, {
    agent: { provider: "codex", model: "selected-model", reasoningEffort: "high",
      permissionMode: "ask", options: { command: "fixture-only" } },
    execution: { initCommands: ["fixture init"] },
  });
  const state = await runExecution(input, dependencies);
  assert.deepEqual(calls, ["repository", "prepare", "worktree", "initialize", "agent"]);
  assert.deepEqual(state.agent, {
    provider: "codex", model: "selected-model", reasoningEffort: "high", permissionMode: "ask",
  });
  assert.equal(Object.hasOwn(state, "codex"), false);
  assert.equal(state.session_id, "persistent-session");
  assert.equal(state.worktree.branch, "existing-prefix/fixture");
  assert.deepEqual(state.source, { channel: "fixture", scope: "scope", id: "task" });
  assert.equal((await runExecution(input, dependencies)).reused, true);
  assert.equal(calls.filter(call => call === "agent").length, 1);
});

test("unsupported providers fail before channel preparation, Git operations or injected sessions", async (t) => {
  for (const provider of ["unimplemented-agent", "", null]) {
    const { input, dependencies, calls } = fixture(t, { agent: { provider } });
    await assert.rejects(runExecution(input, dependencies), /不支持的 CLI 执行器|必须明确配置 agent.provider/);
    assert.deepEqual(calls, []);
    assert.equal(fs.existsSync(path.join(input.directory, "run.json")), false);
    assert.equal(fs.existsSync(path.join(input.directory, ".lock")), false);
  }
});

test("a task without the prompt contract fails before creating its worktree", async (t) => {
  const { input, dependencies, calls } = fixture(t, { agent: { provider: "codex" } });
  input.channel.prepare = async () => ({
    workitem: input.item, task: { execution_ready: true, images: [] },
  });
  await assert.rejects(runExecution(input, dependencies), /任务必须包含 prompt 文本/);
  assert.deepEqual(calls, ["repository"]);
});


test("execution never launches a native CLI implicitly when its session service is missing", async t => {
  const { input, dependencies, calls } = fixture(t, { agent: { provider: "codex" } });
  delete dependencies.startSession;
  await assert.rejects(runExecution(input, dependencies), /显式提供 Agent/);
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(path.join(input.directory, "run.json")), false);
});
