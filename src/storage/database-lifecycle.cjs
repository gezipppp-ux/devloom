const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { ApplicationDatabase } = require("./application-database.cjs");
const { PostgresDatabase } = require("./postgres-database.cjs");
const { databaseForRoot, registerDatabase } = require("./database-registry.cjs");
const { loadEncryptionKey } = require("./database-secrets.cjs");

const pending = new Map();

async function initializeDatabase(directory, { url = process.env.DATABASE_URL } = {}) {
  const dataRoot = path.resolve(directory);
  const rootKey = process.platform === "win32" ? dataRoot.toLowerCase() : dataRoot;
  const identity = createHash("sha256").update(url || "").digest("hex");
  const existing = databaseForRoot(dataRoot);
  if (existing) {
    if (existing.connectionIdentity !== identity) throw new Error("该数据目录已连接其他数据库。");
    return existing;
  }
  const queued = pending.get(rootKey);
  if (queued) {
    if (queued.identity !== identity) throw new Error("该数据目录正在连接其他数据库。");
    return queued.operation;
  }
  const operation = initialize(dataRoot, url, identity);
  pending.set(rootKey, { identity, operation });
  try { return await operation; }
  finally { pending.delete(rootKey); }
}

async function initialize(dataRoot, url, identity) {
  const probe = new PostgresDatabase(url);
  let encryptionKey;
  try {
    await probe.connect();
    const marker = await probe.client.authMetadata.findUnique({ where: { name: "encryption-key-fingerprint" } });
    const protectedRecords = await probe.client.workspaceSetting.count() +
      await probe.client.gitAccount.count() + await probe.client.gitKeyDraft.count();
    if (!process.env.RUNNER_ENCRYPTION_KEY && !fs.existsSync(path.join(dataRoot, "secrets", "database.key")) &&
        (marker || protectedRecords)) throw new Error("数据库凭据主密钥缺失，请恢复 secrets/database.key 后启动。");
    encryptionKey = loadEncryptionKey(dataRoot);
    const fingerprint = createHash("sha256").update(encryptionKey).digest("hex");
    await probe.client.authMetadata.createMany({ data: [{ name: "encryption-key-fingerprint", value: fingerprint }], skipDuplicates: true });
    const recorded = await probe.client.authMetadata.findUniqueOrThrow({ where: { name: "encryption-key-fingerprint" } });
    if (recorded.value !== fingerprint) throw new Error("数据库凭据主密钥与当前部署不匹配。");
    await probe.client.systemSetting.createMany({ data: [{ key: "memberStorageRoot", value: path.join(os.homedir(), ".web-coding-workspaces") }], skipDuplicates: true });
  } finally { await probe.close(); }
  const database = new ApplicationDatabase({ directory: dataRoot, encryptionKey, url });
  try {
    await database.connect();
    database.connectionIdentity = identity;
    registerDatabase(database);
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}

module.exports = { initializeDatabase };
