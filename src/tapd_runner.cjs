const fs = require("node:fs");
const path = require("node:path");
const {
  argument,
  configPath,
  loadConfig,
  loadSession,
  numericId,
  runsPath,
  workspaceId,
} = require("./config.cjs");
const { runExecution, saveState } = require("./execution_runner.cjs");
const { createTapdChannel } = require("./channels/tapd.cjs");

function runRequirement(input, dependencies = {}) {
  return runExecution(
    { ...input, channel: createTapdChannel(input.configFile, dependencies) },
    dependencies,
  );
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Usage: npm run tapd:run --id <story-id> [--workspace <id>] [--config <file>]\nCreates an isolated Git worktree and persistent Codex session with description images.\nUse tapd:task for a preview, tapd:status to inspect, tapd:retry-transition to repair status only.\n",
    );
    return;
  }
  const file = configPath();
  const config = loadConfig(file);
  const session = config.tapd?.session || config;
  const item = {
    id: numericId(argument("--id"), "Item (--id)"),
    workspace_id: numericId(
      workspaceId(session, argument("--workspace")),
      "Workspace",
    ),
    type: "story",
  };
  if (config.workspace && item.workspace_id !== workspaceId(session))
    throw new Error("TAPD 项目与当前工作区绑定不一致。");
  const directory = path.join(
    runsPath(config, file),
    `${item.workspace_id}-${item.id}`,
  );
  if (process.argv.includes("--status")) {
    const state = JSON.parse(
      fs.readFileSync(path.join(directory, "run.json"), "utf8"),
    );
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }
  const state = await runRequirement({
    config,
    configFile: file,
    session: loadSession(file),
    item,
    directory,
    retry: process.argv.includes("--retry-transition"),
  });
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  if (
    state.execution.status !== "completed" ||
    state.transition.status !== "succeeded"
  )
    process.exitCode = 1;
}

if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
module.exports = { runRequirement, saveState };
