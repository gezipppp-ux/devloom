const fs = require("node:fs");
const path = require("node:path");
const { readOptional, writeConfig } = require("./json-files.cjs");

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

function readFetchState(commonDirectory) {
  return readOptional(path.join(commonDirectory, "web-coding-fetch.json"));
}

function writeFetchState(commonDirectory, remote) {
  const value = { remote, fetchedAt: new Date().toISOString() };
  writeConfig(path.join(commonDirectory, "web-coding-fetch.json"), value);
  return value;
}

module.exports = { withRepositoryOperation, readFetchState, writeFetchState };
