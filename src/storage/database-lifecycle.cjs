const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const BetterSqlite3 = require("better-sqlite3");
const knexFactory = require("knex");
const { ApplicationDatabase } = require("./application-database.cjs");
const { databaseForRoot, registerDatabase } = require("./database-registry.cjs");
const { loadEncryptionKey } = require("./database-secrets.cjs");

const pending = new Map();
const defaultMigrationsDirectory = path.join(__dirname, "migrations");

function createConnection(file, migrationsDirectory = defaultMigrationsDirectory) {
  return knexFactory({
    client: "better-sqlite3",
    connection: { filename: file },
    useNullAsDefault: true,
    pool: { min: 1, max: 1, afterCreate(connection, done) {
      connection.pragma("foreign_keys = ON");
      connection.pragma("busy_timeout = 5000");
      done(null, connection);
    } },
    migrations: { directory: migrationsDirectory, loadExtensions: [".cjs"] },
  });
}

function openHandle(file) {
  const handle = new BetterSqlite3(file);
  handle.pragma("busy_timeout = 5000");
  handle.pragma("foreign_keys = ON");
  handle.pragma("journal_mode = WAL");
  return handle;
}

function seedProductionDefaults(handle) {
  handle.prepare("INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING")
    .run("worktreeBasePath", JSON.stringify(path.join(os.homedir(), ".codex-workspaces")), new Date().toISOString());
}

async function initializeDatabase(directory, options = {}) {
  const dataRoot = path.resolve(directory);
  const existing = databaseForRoot(dataRoot);
  if (existing) return existing;
  const key = process.platform === "win32" ? dataRoot.toLowerCase() : dataRoot;
  if (pending.has(key)) return pending.get(key);
  const operation = initialize(dataRoot, options);
  pending.set(key, operation);
  try { return await operation; }
  finally { pending.delete(key); }
}

function liveConnections(directory) {
  if (!fs.existsSync(directory)) return [];
  const active = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error("数据库运行租约目录含未知条目，请人工检查。");
    const file = path.join(directory, entry.name);
    const lease = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Number.isInteger(lease.pid) || lease.pid < 1 || typeof lease.token !== "string")
      throw new Error("数据库运行租约记录无效，请人工检查。");
    try {
      process.kill(lease.pid, 0);
      active.push(lease);
    } catch (error) {
      if (error.code === "ESRCH") fs.unlinkSync(file);
      else active.push(lease);
    }
  }
  return active;
}

async function initialize(dataRoot, options) {
  const directory = path.join(dataRoot, "db");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, ".upgrade.lock");
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error("数据库升级被锁定。请确认其他服务和升级进程均已停止后检查 db/.upgrade.lock。");
  }
  const file = path.join(directory, "web-coding.sqlite");
  const existed = fs.existsSync(file);
  const leases = path.join(directory, "connections");
  let knex;
  let handle;
  try {
    knex = createConnection(file, options.migrationsDirectory);
    const [completed, upcoming] = await knex.migrate.list();
    if (upcoming.length && liveConnections(leases).length)
      throw new Error("检测到使用当前数据库的运行进程，请停止全部 Web 服务及 CLI 执行后升级。");
    if (upcoming.length && existed) {
      if (!completed.length) {
        const known = await knex("sqlite_master").where({ type: "table" }).select("name");
        if (known.some(({ name }) => !["knex_migrations", "knex_migrations_lock", "sqlite_sequence"].includes(name)))
          throw new Error("数据库包含未登记版本的表，无法自动升级；不会导入或覆盖已有数据。");
      }
      const backups = path.join(directory, "backups");
      fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
      const source = openHandle(file);
      try {
        await source.backup(path.join(backups, "before-" + Date.now() + "-" + randomUUID() + ".sqlite"));
      } finally { source.close(); }
    }
    await knex.migrate.latest();
    await knex.destroy();
    knex = null;
    handle = openHandle(file);
    seedProductionDefaults(handle);
    const keyFile = path.join(dataRoot, "secrets", "database.key");
    if (!process.env.RUNNER_ENCRYPTION_KEY && !fs.existsSync(keyFile) &&
        handle.prepare("SELECT COUNT(*) AS count FROM workspace_settings").get().count > 0)
      throw new Error("数据库凭据主密钥缺失，请恢复 secrets/database.key 后启动。");
    const database = new ApplicationDatabase(dataRoot, handle, loadEncryptionKey(dataRoot));
    fs.mkdirSync(leases, { recursive: true, mode: 0o700 });
    const lease = { pid: process.pid, token: randomUUID() };
    const leaseFile = path.join(leases, lease.pid + "-" + lease.token + ".json");
    fs.writeFileSync(leaseFile, JSON.stringify(lease), { flag: "wx", mode: 0o600 });
    database.onClose = () => {
      try { fs.unlinkSync(leaseFile); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    };
    registerDatabase(database);
    return database;
  } catch (error) {
    if (handle?.open) handle.close();
    throw new Error("数据库初始化或升级失败，服务未启动：" + error.message, { cause: error });
  } finally {
    if (knex) await knex.destroy();
    fs.rmdirSync(lock);
  }
}

async function databaseStatus(directory, options = {}) {
  const file = path.join(path.resolve(directory), "db", "web-coding.sqlite");
  const migrationsDirectory = options.migrationsDirectory || defaultMigrationsDirectory;
  if (!fs.existsSync(file)) return { exists: false, completed: [], pending: fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".cjs")) };
  const handle = new BetterSqlite3(file, { readonly: true, fileMustExist: true });
  try {
    const initialized = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knex_migrations'").get();
    const completed = initialized ? handle.prepare("SELECT name FROM knex_migrations ORDER BY id").all().map(({ name }) => name) : [];
    const available = fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".cjs")).sort();
    return { exists: true, completed, pending: available.filter((name) => !completed.includes(name)) };
  } finally { handle.close(); }
}

module.exports = { initializeDatabase, databaseStatus };
