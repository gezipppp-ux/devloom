const path = require('node:path');
const { dataRoot, inputPath } = require('../config/runtime.cjs');

function argument(name, fallback = null, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value.`);
  return value;
}

function configPath(value, argv = process.argv.slice(2), env = process.env) {
  const explicit =
    value === undefined ? argument('--config', null, argv) : value;
  const workspace =
    argument('--app-workspace', null, argv) || env.RUNNER_WORKSPACE;
  if (workspace && !explicit) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        workspace,
      )
    )
      throw new Error('Invalid --app-workspace ID.');
    return path.join(dataRoot, 'workspaces', workspace, 'config.json');
  }
  const selected = explicit || env.TAPD_CONFIG;
  return selected
    ? inputPath(selected, env)
    : path.join(dataRoot, 'config', 'tapd.local.json');
}

module.exports = { argument, configPath };
