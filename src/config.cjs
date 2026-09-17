const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dataRoot = process.env.RUNNER_DATA_DIR
  ? path.resolve(process.env.RUNNER_DATA_DIR)
  : root;

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value.`);
  return value;
}

function configPath(value = argument('--config')) {
  const selected = value || process.env.TAPD_CONFIG;
  return selected
    ? inputPath(selected)
    : path.join(dataRoot, 'config', 'tapd.local.json');
}

function inputPath(value) {
  return path.resolve(process.env.INIT_CWD || process.cwd(), value);
}

function loadConfig(value) {
  const file = configPath(value);
  if (!fs.existsSync(file))
    throw new Error(
      `Missing TAPD configuration: ${file}. Run npm run tapd:session or npm run tapd:auth:cookie.`,
    );
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function loadSession(value) {
  const config = loadConfig(value);
  const session = config.tapd?.session || config;
  if (!session.cookie_header || !session.request_body?.dsc_token)
    throw new Error('TAPD session is incomplete. Refresh the local session.');
  return session;
}

function workspaceId(session, value) {
  if (value) return String(value);
  const ids = session.request_body?.select_workspace_ids || [];
  if (ids.length > 1)
    throw new Error(
      'Choose --workspace when the captured session contains multiple workspaces.',
    );
  const id = ids[0] || session.request_body?.group_id;
  if (!id) throw new Error('Provide --workspace <workspace-id>.');
  return String(id);
}

function numericId(value, label) {
  if (!/^\d+$/.test(String(value || '')))
    throw new Error(`${label} must be a TAPD numeric ID.`);
  return String(value);
}

module.exports = {
  argument,
  configPath,
  inputPath,
  loadConfig,
  loadSession,
  numericId,
  root,
  dataRoot,
  workspaceId,
};
