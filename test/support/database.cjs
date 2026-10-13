const path = require("node:path");
const { initializeDatabase } = require("../../src/storage/database-lifecycle.cjs");
const { postgresFixture } = require("./postgres.cjs");

const fixtures = new Map();

// Each data root has its own PostgreSQL schema. Reopening retains its schema;
// cleanup never uses a production DATABASE_URL or scans unrelated schemas.
async function initializeTestDatabase(t, directory, { withSetup = false } = {}) {
  const key = path.resolve(directory);
  if (!fixtures.has(key)) {
    const pending = (async () => {
      const fixture = await postgresFixture(t);
      await fixture.deploy();
      t.after(() => fixtures.delete(key));
      return fixture;
    })();
    fixtures.set(key, pending);
  }
  const fixture = await fixtures.get(key);
  const database = await initializeDatabase(directory, { url: fixture.url });
  // Existing suites seed an already configured installation. Setup suites opt in
  // to the real fresh-install lifecycle instead of weakening the HTTP gate.
  if (!withSetup) await database.client.systemSetup.updateMany({ where: { id: "installation", status: "awaiting_admin" }, data: { status: "not_required" } });
  database.testUrl = fixture.url;
  fixture.track(database);
  return database;
}

module.exports = { initializeTestDatabase };
