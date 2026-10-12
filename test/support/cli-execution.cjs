const assert = require("node:assert/strict");
const { startSession } = require("../../src/codex/cli-session.cjs");

function startFixtureSession({ agent, config, ...options }) {
  assert.equal(config.command, process.execPath, "Execution tests must use a Node fixture, never a real CLI");
  assert.ok(config.command_args?.length, "A fixture script is required");
  return startSession({ ...options, config: {
    ...config, model: agent.model, reasoning_effort: agent.reasoningEffort,
    startup_timeout_ms: agent.startupTimeoutMs,
  } });
}

module.exports = { startFixtureSession };
