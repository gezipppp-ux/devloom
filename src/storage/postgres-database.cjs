const { AsyncLocalStorage } = require("node:async_hooks");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient, Prisma } = require("../../generated/prisma-runtime/client.cjs");
const { postgresOptions } = require("../domain/postgres-options.cjs");
const { readPostgresMigrations, verifyPostgresMigrations } = require("./postgres-migrations.cjs");

class PostgresDatabase {
  constructor(url = process.env.DATABASE_URL) {
    const { pool, schema } = postgresOptions(url);
    this.schema = schema;
    this.jsonNull = Prisma.JsonNull;
    this.baseClient = new PrismaClient({ adapter: new PrismaPg(pool, { schema }), log: [] });
    this.context = new AsyncLocalStorage();
    this.ready = false;
    this.closed = false;
  }

  get client() {
    if (!this.ready || this.closed) throw new Error("PostgreSQL 连接尚未就绪或已关闭。");
    return this.context.getStore()?.client || this.baseClient;
  }

  async connect() {
    if (this.closed) throw new Error("PostgreSQL 连接已关闭。");
    if (this.ready) return this;
    if (!this.connecting) this.connecting = this.initialize();
    return this.connecting;
  }

  async initialize() {
    try {
      try { await this.baseClient.$connect(); }
      catch { throw new Error("无法连接 PostgreSQL，请检查数据库服务与 DATABASE_URL。"); }
      let applied;
      try {
        // schema is validated as a single identifier before constructing SQL.
        const table = Prisma.raw(`"${this.schema}"."_prisma_migrations"`);
        applied = await this.baseClient.$queryRaw(Prisma.sql`
          SELECT migration_name, checksum, finished_at, rolled_back_at FROM ${table}`);
      } catch {
        throw new Error("无法读取 PostgreSQL 迁移记录，请先运行 npm run db:deploy 并检查数据库权限。");
      }
      verifyPostgresMigrations(readPostgresMigrations(), applied);
      this.ready = true;
      return this;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async transaction(operation) {
    // Short database-only callbacks. Nested stores share the outer transaction;
    // a caught inner failure still rolls back the complete unit of work.
    const existing = this.context.getStore();
    if (existing) {
      try { return await operation(this.client); }
      catch (error) { existing.failure ||= error; throw error; }
    }
    return this.client.$transaction(async (client) => {
      const scope = { client, failure: null };
      return this.context.run(scope, async () => {
        const result = await operation(client);
        if (scope.failure) throw scope.failure;
        return result;
      });
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 5000 });
  }

  async close() {
    this.closed = true;
    this.ready = false;
    this.closing ||= this.baseClient.$disconnect();
    await this.closing;
  }
}

module.exports = { PostgresDatabase };
