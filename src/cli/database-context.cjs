const path = require("node:path");
const { dataRoot } = require("../config/runtime.cjs");
const { initializeDatabase } = require("../storage/database-lifecycle.cjs");
const { AccountStore } = require("../storage/account-store.cjs");
const { argument } = require("./arguments.cjs");

async function prepareCliDatabase(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--help")) return null;
  const database = await initializeDatabase(env.RUNNER_DATA_DIR ? path.resolve(env.RUNNER_DATA_DIR) : dataRoot);
  try {
    const accounts = new AccountStore(database);
    const explicitConfig = argument("--config", null, argv);
    const workspaceId = explicitConfig
      ? undefined
      : argument("--app-workspace", null, argv) || env.RUNNER_WORKSPACE;
    if (workspaceId) {
      const config = database.readWorkspace(workspaceId);
      const owner = accounts.byId(config.workspace.owner_user_id);
      if (!owner || owner.status !== "active") throw new Error("工作区所有者已停用，不能执行操作。");
    }
    accounts.audit(null, "local_cli", workspaceId, { actorType: "local_operator" });
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

module.exports = { prepareCliDatabase };
