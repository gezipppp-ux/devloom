const { loadSession } = require('../../channels/tapd/config.cjs');
const { searchUsers } = require('../../channels/tapd/users.cjs');
const { argument, configPath } = require('../arguments.cjs');
const { execute } = require('../execute.cjs');

async function main(
  argv = process.argv.slice(2),
  env = process.env,
  dependencies = {},
) {
  const services = {
    loadSession,
    searchUsers,
    stdout: process.stdout,
    ...dependencies,
  };
  const session = services.loadSession(configPath(undefined, argv, env));
  const query = argument('--query', null, argv) || argument('--q', null, argv);
  const workspace =
    argument('--workspace', null, argv) ||
    session.request_body?.group_id ||
    session.request_body?.select_workspace_ids?.[0];
  const requested = Number(argument('--per-page', null, argv));
  const users = await services.searchUsers(session, {
    query,
    workspace,
    perPage: Number.isInteger(requested) && requested > 0 ? requested : 10,
  });
  services.stdout.write(
    `${JSON.stringify(
      {
        workspace_id: String(workspace),
        query,
        count: users.length,
        users: users.map((user) => ({
          id: String(user.id),
          nick: user.nick || '',
          name: user.name || '',
          name_pinyin: user.name_pinyin || '',
        })),
      },
      null,
      2,
    )}\n`,
  );
}

if (require.main === module) execute(main, 'TAPD user search failed: ', { database: true });
module.exports = { main };
