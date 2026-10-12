const path = require("node:path");

/** @type {Map<string, import('./application-database.cjs').ApplicationDatabase>} */
const databases = new Map();

function key(directory) {
  const resolved = path.resolve(directory);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function registerDatabase(database) {
  const existing = databases.get(key(database.dataRoot));
  if (existing && existing !== database)
    throw new Error("该数据目录已经打开数据库。");
  databases.set(key(database.dataRoot), database);
}

function unregisterDatabase(database) {
  if (databases.get(key(database.dataRoot)) === database)
    databases.delete(key(database.dataRoot));
}

function databaseForRoot(directory) {
  return databases.get(key(directory));
}

function databaseForPath(file) {
  if (typeof file !== "string") return undefined;
  const target = path.resolve(file);
  const candidates = [...databases.values()].sort((a, b) => b.dataRoot.length - a.dataRoot.length);
  for (const database of candidates) {
    const relative = path.relative(database.dataRoot, target).split(path.sep).join("/");
    if (!relative || /^(?:workspaces|runs|uploads|cache)(?:\/|$)/.test(relative) ||
        ["system-settings.json", "repository-operations.json"].includes(relative)) return database;
  }
  return undefined;
}

module.exports = { databaseForRoot, databaseForPath, registerDatabase, unregisterDatabase };
