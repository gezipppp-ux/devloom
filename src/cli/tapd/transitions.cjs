const { loadConfig } = require('../../config/runtime.cjs');
const { loadSession } = require('../../channels/tapd/config.cjs');
const { selectItem } = require('../../channels/tapd/detail.cjs');
const {
  applyTransition,
  workflowInfo,
  transitionSummary,
} = require('../../channels/tapd/workflow.cjs');
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
    selectItem,
    applyTransition,
    workflowInfo,
    stdout: process.stdout,
    ...dependencies,
  };
  const file = configPath(undefined, argv, env);
  const config = services.loadConfig(file);
  const session = services.loadSession(file);
  const options = selectionArguments(argv);
  options.id ||= config.workflow?.test_item_id;
  if (argv.includes('--apply') && !options.id)
    throw new Error('Choose an explicit --id before changing TAPD status.');
  const item = await services.selectItem(session, options);
  let result;
  if (argv.includes('--apply')) {
    result = await services.applyTransition(
      session,
      item,
      config.workflow,
      argument('--to', null, argv),
    );
  } else {
    const info = await services.workflowInfo(session, item);
    result = {
      item_id: item.id,
      current_status: info.current_status,
      transitions: transitionSummary(info),
    };
  }
  services.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) execute(main, '', { database: true });
module.exports = { main };
