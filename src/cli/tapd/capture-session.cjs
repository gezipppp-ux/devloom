const { captureSession } = require('../../channels/tapd/capture-session.cjs');
const { saveSession } = require('../../channels/tapd/auth-utils.cjs');
const { argument, configPath } = require('../arguments.cjs');
const { execute } = require('../execute.cjs');

async function main(
  argv = process.argv.slice(2),
  env = process.env,
  dependencies = {},
) {
  const services = {
    captureSession,
    saveSession,
    stdout: process.stdout,
    ...dependencies,
  };
  const file = configPath(
    argument('--output', null, argv) || argument('--config', null, argv),
    argv,
    env,
  );
  const session = await services.captureSession(
    env.TAPD_CDP_URL || 'http://127.0.0.1:9222',
  );
  const saved = services.saveSession(session, file);
  services.stdout.write(`Saved local TAPD configuration to ${saved}\n`);
}

if (require.main === module) execute(main, 'TAPD session bootstrap failed: ');
module.exports = { main };
