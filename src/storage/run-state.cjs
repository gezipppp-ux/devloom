const fs = require("node:fs");
const { withFileLock } = require("./file-lock.cjs");
const { writeConfig } = require("./json-files.cjs");
const { databaseForPath } = require("./database-registry.cjs");

function readState(file) {
  const database = databaseForPath(file);
  if (database) {
    const value = database.readDocument(file);
    if (value === undefined) throw Object.assign(new Error("运行记录不存在。"), { code: "ENOENT" });
    return value;
  }
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeState(file, state) {
  state.updated_at = new Date().toISOString();
  writeConfig(file, state);
  return state;
}

function saveState(file, state) {
  const database = databaseForPath(file);
  if (database) return database.transaction(() => writeState(file, state));
  return withFileLock(file, () => writeState(file, state), "Run state");
}

function updateState(file, patch) {
  const database = databaseForPath(file);
  if (database) return database.transaction(() => writeState(file, { ...readState(file), ...patch }));
  return withFileLock(file, () => {
    const current = readState(file);
    return writeState(file, { ...current, ...patch });
  }, "Run state");
}

module.exports = { readState, saveState, updateState };
