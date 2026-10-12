const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { agentConfig, executionOptions, taskPrompt } = require("../../src/domain/agent-config.cjs");
const { executionConfig } = require("../../src/config/execution-settings.cjs");
const { temporary } = require("../support/helpers.cjs");

test("agent selection and provider options stay separate from repository settings", () => {
  const config = {
    execution: { repository: "/repo", worktreeRoot: "/trees", initCommands: ["npm ci"],
      gitAccountId: "git-account", remoteUrl: "https://example.invalid/repo" },
    agent: { provider: "codex", model: "selected-model", reasoningEffort: "high",
      permissionMode: "ask", startupTimeoutMs: 25,
      options: { command: "/fake-agent", command_args: ["fixture"] } },
  };
  assert.deepEqual(agentConfig(config), config.agent);
  assert.equal(executionOptions(config).gitAccountId, "git-account");
  assert.equal(executionOptions(config).repository, "/repo");
  assert.equal(Object.hasOwn(executionOptions(config), "model"), false);
});

test("normalized configuration preserves explicit clearing and creates no vendor mirror", async (t) => {
  const root = temporary(t);
  const input = {
    agent: { provider: "codex", model: "", reasoningEffort: "", options: { command: process.execPath } },
    execution: { repository: "new-repo", initCommands: [], baseRef: "main", worktreeRoot: root },
  };
  const config = await executionConfig(input, path.join(root, "config.json"));
  assert.equal(config.agent.model, "");
  assert.equal(config.agent.reasoningEffort, "");
  assert.equal(config.execution.repository, "new-repo");
  assert.deepEqual(config.execution.initCommands, []);
  assert.equal(Object.hasOwn(config, "codex"), false);
  assert.equal(config.agent.options.command, process.execPath);
  assert.deepEqual(await executionConfig(config, path.join(root, "config.json")), config);
  assert.deepEqual(input.execution.initCommands, []);
});

test("agent records require an explicit provider and never reinterpret old settings", () => {
  for (const input of [{}, { agent: {} }, { agent: { provider: "" } },
    { agent: { provider: null } }, { codex: { model: "old", command: "old" } }])
    assert.throws(() => agentConfig(input), /必须明确配置 agent.provider/);
  const selected = agentConfig({ agent: { provider: "future-agent" } });
  assert.equal(selected.provider, "future-agent");
  assert.deepEqual(selected.options, {});
  assert.equal(executionOptions({ codex: { repository: "/old" } }).repository, undefined);
});

test("task prompts read only the current task contract", () => {
  assert.equal(taskPrompt({ prompt: "new" }), "new");
  assert.equal(taskPrompt({ prompt: "" }), "");
  assert.equal(taskPrompt({ codex_prompt: "old" }), undefined);
});
