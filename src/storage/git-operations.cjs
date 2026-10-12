const fs = require("node:fs");
const path = require("node:path");
const { readOptional, writeConfig } = require("./json-files.cjs");
const { createHash } = require("node:crypto");
const { databaseForPath } = require("./database-registry.cjs");

function fetchStateFile(commonDirectory, configFile) {
  const database = databaseForPath(configFile);
  if (!database) return path.join(commonDirectory, "web-coding-fetch.json");
  const identity = process.platform === "win32" ? commonDirectory.toLowerCase() : commonDirectory;
  const hash = createHash("sha256").update(identity).digest("hex");
  return path.join(database.dataRoot, "cache", "repository-records", `${hash}.json`);
}

async function withRepositoryOperation(commonDirectory, operation) {
  const lock = path.join(commonDirectory, "web-coding-operation.lock");
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(
      "此仓库已有 Git 操作正在进行，请稍后重试。若服务曾异常退出，请确认操作已停止后检查 web-coding-operation.lock。",
    );
  }
  try {
    return await operation();
  } finally {
    fs.rmdirSync(lock);
  }
}

async function readFetchState(commonDirectory, configFile) {
  return (await readOptional(fetchStateFile(commonDirectory, configFile)));
}

async function writeFetchState(commonDirectory, remote, configFile) {
  const value = { remote, fetchedAt: new Date().toISOString() };
  (await writeConfig(fetchStateFile(commonDirectory, configFile), value));
  return value;
}

module.exports = { withRepositoryOperation, readFetchState, writeFetchState };
