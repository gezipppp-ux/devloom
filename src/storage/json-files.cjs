const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { withFileLock } = require("./file-lock.cjs");
const { databaseForPath } = require("./database-registry.cjs");

function readOptional(file) {
  const database = databaseForPath(file);
  if (database) return database.readDocument(file) ?? {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function writeConfig(file, value) {
  const database = databaseForPath(file);
  if (database) return database.writeDocument(file, value);
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
function updateConfig(file, update) {
  const database = databaseForPath(file);
  if (database) return database.updateDocument(file, update);
  return withFileLock(file, () => {
    const value = update(readOptional(file));
    writeConfig(file, value);
    return value;
  });
}

module.exports = { readOptional, writeConfig, updateConfig };
