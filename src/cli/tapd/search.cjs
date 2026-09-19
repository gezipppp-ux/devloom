const fs = require('node:fs');
const path = require('node:path');
const { inputPath } = require('../../config/runtime.cjs');
const { loadSession } = require('../../channels/tapd/config.cjs');
const { todos } = require('../../channels/tapd/detail.cjs');
const { argument, configPath } = require('../arguments.cjs');
const { selectionArguments } = require('./selection.cjs');
const { execute } = require('../execute.cjs');

async function main(
  argv = process.argv.slice(2),
  env = process.env,
  dependencies = {},
) {
  const services = {
    loadSession,
    todos,
    stdout: process.stdout,
    ...dependencies,
  };
  const items = (
    await services.todos(
      services.loadSession(configPath(undefined, argv, env)),
      selectionArguments(argv),
    )
  ).map((item) => ({
    id: item.id,
    workspace_id: item.workspace_id,
    type: item.entity_type || item.type,
    title: item.title || item.name,
    status: item.status,
    priority: item.priority,
    owner: item.owner || item.current_owner,
    detail_url: item.detail_url || item.title_url,
    updated_at: item.modified,
  }));
  const serialized = JSON.stringify(
    {
      fetched_at: new Date().toISOString(),
      source: 'tapd-http',
      total: items.length,
      items,
    },
    null,
    2,
  );
  const output = argument('--output', null, argv);
  if (output) {
    const file = inputPath(output, env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serialized, 'utf8');
  }
  services.stdout.write(`${serialized}\n`);
}

if (require.main === module) execute(main, '', { database: true });
module.exports = { main };
