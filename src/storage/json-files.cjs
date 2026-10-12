const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { withAsyncFileLock } = require("./file-lock.cjs");
const { databaseForPath } = require("./database-registry.cjs");

async function readOptional(file) {
  const database = databaseForPath(file);
  if (database) return (await database.readDocument(file)) ?? {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeConfig(file, value) {
  const database = databaseForPath(file);
  if (database) return (await database.writeDocument(file, value));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

// Serialize read-modify-write across service processes without holding a lock
// during network or Git operations. A crashed writer's lock fails closed.
async function updateConfig(file, update) {
  const database = databaseForPath(file);
  if (database) return (await database.updateDocument(file, update));
  return (await withAsyncFileLock(file, async () => {
    const value = await update((await readOptional(file)));
    (await writeConfig(file, value));
    return value;
  }));
}

module.exports = { readOptional, writeConfig, updateConfig };
