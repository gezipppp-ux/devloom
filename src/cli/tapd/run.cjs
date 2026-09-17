const path = require('node:path');
const { loadConfig, runsPath } = require('../../config/runtime.cjs');
const {
  loadSession,
  numericId,
  workspaceId,
} = require('../../channels/tapd/config.cjs');
const { runRequirement, readRunStatus } = require('../../application/tapd-run.cjs');
const { argument, configPath } = require('../arguments.cjs');
const { execute } = require('../execute.cjs');

async function main(
  argv = process.argv.slice(2),
  env = process.env,
  dependencies = {},
) {
  const services = {
    loadConfig,
    loadSession,
    runRequirement,
    readRunStatus,
    stdout: process.stdout,
    stderr: process.stderr,
    ...dependencies,
  };
  if (argv.includes('--help')) {
    services.stdout.write(
      'Usage: npm run tapd:run --id <story-id> [--workspace <id>] [--config <file>]\nCreates an isolated Git worktree and persistent Codex session with description images.\nUse tapd:task for a preview, tapd:status to inspect, tapd:retry-transition to repair status only.\n',
    );
    return;
  }
  const file = configPath(undefined, argv, env);
  const config = services.loadConfig(file);
  const session = config.tapd?.session || config;
  const item = {
    id: numericId(argument('--id', null, argv), 'Item (--id)'),
    workspace_id: numericId(
      workspaceId(session, argument('--workspace', null, argv)),
      'Workspace',
    ),
    type: 'story',
  };
  if (config.workspace && item.workspace_id !== workspaceId(session))
    throw new Error('TAPD 项目与当前工作区绑定不一致。');
  const directory = path.join(
    runsPath(config, file),
    `${item.workspace_id}-${item.id}`,
  );
  if (argv.includes('--status')) {
    const state = services.readRunStatus(directory);
    services.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }
  const state = await services.runRequirement(
    {
      config,
      configFile: file,
      session: services.loadSession(file),
      item,
      directory,
      retry: argv.includes('--retry-transition'),
    },
    {
      onSession(sessionId, worktree) {
        services.stderr.write(
          `Codex session: ${sessionId}\nWorktree: ${worktree.path}\n`,
        );
      },
      onTransition(transition) {
        services.stderr.write(`Channel transition: ${transition.status}\n`);
      },
    },
  );
  services.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  return state.execution.status === 'completed' &&
    state.transition.status === 'succeeded'
    ? 0
    : 1;
}

if (require.main === module) execute(main);
module.exports = { main };
