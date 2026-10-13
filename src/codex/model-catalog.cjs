const { AppServerClient } = require("./app-server-client.cjs");
const { listModels } = require("./models.cjs");

// Native metadata discovery uses its own process without a supplier override.
// Never create/resume a thread or share the connection of an executing task.
async function readModelCatalog({ client = new AppServerClient() } = {}) {
  try { return await listModels(client, { includeHidden: true }); }
  finally { await client.close(); }
}

module.exports = { readModelCatalog };
