const {
  sessionFromCookie,
  saveSession,
} = require('../../channels/tapd/auth-utils.cjs');
const { configPath } = require('../arguments.cjs');
const { execute } = require('../execute.cjs');

async function main(
  argv = process.argv.slice(2),
  env = process.env,
  dependencies = {},
) {
  const services = {
    sessionFromCookie,
    saveSession,
    stdout: process.stdout,
    ...dependencies,
  };
  if (!env.TAPD_COOKIE_HEADER)
    throw new Error('TAPD_COOKIE_HEADER is required.');
  if (!env.TAPD_WORKSPACE_ID) throw new Error('TAPD_WORKSPACE_ID is required.');
  const session = services.sessionFromCookie({
    cookieHeader: env.TAPD_COOKIE_HEADER,
    workspaceId: env.TAPD_WORKSPACE_ID,
    dscToken: env.TAPD_DSC_TOKEN,
  });
  const saved = services.saveSession(
    session,
    configPath(env.TAPD_SESSION_OUTPUT, argv, env),
  );
  services.stdout.write(`Saved local TAPD configuration to ${saved}\n`);
}

if (require.main === module) execute(main, 'Cookie session setup failed: ');
module.exports = { main };
