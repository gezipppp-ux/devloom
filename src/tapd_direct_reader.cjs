const fs = require('node:fs');
const path = require('node:path');
const { inputPath } = require('./config.cjs');
const {
  argument,
  loadSession,
  selectionArguments,
  todos,
} = require('./tapd_direct_detail.cjs');

async function main() {
  const items = (await todos(loadSession(), selectionArguments())).map(
    (item) => ({
      id: item.id,
      workspace_id: item.workspace_id,
      type: item.entity_type || item.type,
      title: item.title || item.name,
      status: item.status,
      priority: item.priority,
      owner: item.owner || item.current_owner,
      detail_url: item.detail_url || item.title_url,
      updated_at: item.modified,
    }),
  );
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
  const output = argument('--output');
  if (output) {
    const file = inputPath(output);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serialized, 'utf8');
  }
  process.stdout.write(`${serialized}\n`);
}

if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
