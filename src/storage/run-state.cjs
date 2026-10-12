const fs = require("node:fs");
const { withAsyncFileLock } = require("./file-lock.cjs");
const { writeConfig } = require("./json-files.cjs");
const { databaseForPath } = require("./database-registry.cjs");

async function readState(file) {
  const database = databaseForPath(file);
  if (database) {
    const value = (await database.readDocument(file));
    if (value === undefined) throw Object.assign(new Error("运行记录不存在。"), { code: "ENOENT" });
    return value;
  }
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

async function writeState(file, state) {
  state.updated_at = new Date().toISOString();
  (await writeConfig(file, state));
  return state;
}

async function saveState(file, state) {
  const database = databaseForPath(file);
  if (database) return (await database.transaction(async () => (await writeState(file, state))));
  return (await withAsyncFileLock(file, async () => (await writeState(file, state)), "Run state"));
}

async function updateState(file, patch) {
  const database = databaseForPath(file);
  if (database) return (await database.transaction(async () => (await writeState(file, { ...(await readState(file)), ...patch }))));
  return (await withAsyncFileLock(file, async () => {
    const current = (await readState(file));
    return (await writeState(file, { ...current, ...patch }));
  }, "Run state"));
}

module.exports = { readState, saveState, updateState };
