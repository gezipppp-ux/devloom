const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const migrationsDirectory = path.resolve(__dirname, "../../prisma/migrations");

function readPostgresMigrations(directory = migrationsDirectory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      if (!/^\d{14}_[a-z0-9_]+$/.test(entry.name))
        throw new Error("PostgreSQL 迁移目录名称无效。");
      const sql = fs.readFileSync(path.join(directory, entry.name, "migration.sql"));
      return { name: entry.name, checksum: createHash("sha256").update(sql).digest("hex") };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function verifyPostgresMigrations(expected, applied) {
  if (!expected.length) throw new Error("没有可用的 PostgreSQL 版本化迁移。");
  if (applied.some((row) => !row.finished_at && !row.rolled_back_at))
    throw new Error("PostgreSQL 存在失败或未完成的迁移，请由运维处理后重试。");
  const completed = new Map(applied.filter((row) => row.finished_at && !row.rolled_back_at)
    .map((row) => [row.migration_name, row.checksum]));
  if ([...completed.keys()].some((name) => !expected.some((entry) => entry.name === name)))
    throw new Error("PostgreSQL 数据库版本不属于当前应用，请使用新的数据库/schema 和数据目录；旧数据不兼容、不迁移。");
  if (expected.some((entry) => !completed.has(entry.name)))
    throw new Error("PostgreSQL 存在待执行迁移，请先运行 npm run db:deploy。");
  if (expected.some((entry) => completed.get(entry.name) !== entry.checksum))
    throw new Error("PostgreSQL 已执行迁移的校验值不匹配，不允许修改已发布的迁移。");
}

module.exports = { readPostgresMigrations, verifyPostgresMigrations };
