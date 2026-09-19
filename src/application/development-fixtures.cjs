const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { initializeDatabase } = require("../storage/database-lifecycle.cjs");
const { AccountStore } = require("../storage/account-store.cjs");
const { hashPassword } = require("../storage/account-passwords.cjs");
const { withFixtureDirectory } = require("../storage/fixture-directory.cjs");
const { WorkspaceManager } = require("./workspace-manager.cjs");

async function seedDevelopmentFixtures(directory) {
  return withFixtureDirectory(directory, async () => {
    const database = await initializeDatabase(directory);
    try {
      const accounts = new AccountStore(database);
      const workspaces = new WorkspaceManager({ directory: path.join(directory, "workspaces"), database });
      const credentials = [];
      const samples = [];
      for (const [username, role] of [["fixture-admin", "admin"], ["fixture-alice", "member"], ["fixture-bob", "member"]]) {
        const password = randomBytes(18).toString("base64url");
        const account = accounts.create({ username, role, password_hash: await hashPassword(password) }, { initial: role === "admin" });
        credentials.push({ username, role, password });
        if (role === "member") samples.push({ owner: username, ...workspaces.save({ name: "示例项目" }, undefined, account) });
      }
      accounts.audit(null, "fixtures.created", null, {
        source: "local_cli",
        users: credentials.map(({ username }) => username),
      });
      return { dataDirectory: directory, accounts: credentials, workspaces: samples };
    } finally {
      database.close();
    }
  });
}

module.exports = { seedDevelopmentFixtures };
