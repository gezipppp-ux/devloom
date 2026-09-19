const { loadSession } = require('../../channels/tapd/config.cjs');
const { detail, selectItem } = require('../../channels/tapd/detail.cjs');
const { configPath } = require('../arguments.cjs');
const { selectionArguments } = require('./selection.cjs');
const { execute } = require('../execute.cjs');

async function main(
  argv = process.argv.slice(2),
  env = process.env,
  dependencies = {},
) {
  const services = {
    loadSession,
    detail,
    selectItem,
    stdout: process.stdout,
    ...dependencies,
  };
  const session = services.loadSession(configPath(undefined, argv, env));
  const result = await services.detail(
    session,
    await services.selectItem(session, selectionArguments(argv)),
  );
  services.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) execute(main, '', { database: true });
module.exports = { main };
