/* Build a local TAPD HTTP session from a user-supplied, already-valid Cookie. */
const {
  buildSession,
  parseCookieHeader,
  saveSession,
  todoRequest,
} = require('./tapd_auth_utils.cjs');

const cookieHeader = process.env.TAPD_COOKIE_HEADER;
const workspaceId = process.env.TAPD_WORKSPACE_ID;
const output = process.env.TAPD_SESSION_OUTPUT;

try {
  if (!cookieHeader) throw new Error('TAPD_COOKIE_HEADER is required.');
  if (!workspaceId) throw new Error('TAPD_WORKSPACE_ID is required.');
  const cookies = parseCookieHeader(cookieHeader);
  const dscToken = process.env.TAPD_DSC_TOKEN || cookies['dsc-token'];
  if (!dscToken)
    throw new Error(
      'The Cookie must include dsc-token, or set TAPD_DSC_TOKEN separately.',
    );
  const referer = `https://www.tapd.cn/tapd_fe/my/work?left_tree=1`;
  const saved = saveSession(
    buildSession({
      cookieHeader,
      requestBody: todoRequest({ workspaceId, dscToken }),
      referer,
    }),
    output,
  );
  process.stdout.write(`Saved local TAPD configuration to ${saved}\n`);
} catch (error) {
  process.stderr.write(`Cookie session setup failed: ${error.message}\n`);
  process.exit(1);
}
