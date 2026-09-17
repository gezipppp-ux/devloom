const path = require('node:path');
const { inputPath, loadConfig, runsPath } = require('../../config/runtime.cjs');
const { loadSession } = require('../../channels/tapd/config.cjs');
const { detail, selectItem } = require('../../channels/tapd/detail.cjs');
const { buildTask } = require('../../channels/tapd/task-package.cjs');
const { argument, configPath } = require('../arguments.cjs');
const { selectionArguments } = require('./selection.cjs');
const { execute } = require('../execute.cjs');

async function main(
  argv = process.argv.slice(2),
  env = process.env,
  dependencies = {},
) {
  const services = {
    loadConfig,
    loadSession,
    detail,
    selectItem,
    buildTask,
    stdout: process.stdout,
    ...dependencies,
  };
  const file = configPath(undefined, argv, env);
  const config = services.loadConfig(file);
  const session = services.loadSession(file);
  const item = await services.detail(
    session,
    await services.selectItem(session, selectionArguments(argv)),
  );
  const directory = inputPath(
    argument('--output', null, argv) ||
      path.join(
        runsPath(config, file),
        `${item.workspace_id}-${item.id}`,
        'preview',
      ),
    env,
  );
  const task = await services.buildTask(item, session, directory, config);
  services.stdout.write(
    `${JSON.stringify({ output: directory, execution_ready: task.execution_ready, image_count: task.images.length, workitem_id: item.id }, null, 2)}\n`,
  );
}

if (require.main === module) execute(main);
module.exports = { main };
