function postgresOptions(value) {
  if (typeof value !== "string" || !value.trim())
    throw new Error("请配置 PostgreSQL DATABASE_URL。");
  let url;
  try { url = new URL(value); }
  catch { throw new Error("DATABASE_URL 必须是有效的 PostgreSQL 连接地址。"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname || !url.pathname.slice(1) || url.hash)
    throw new Error("DATABASE_URL 必须指定 PostgreSQL 主机和数据库。");
  const schemas = url.searchParams.getAll("schema");
  const schema = schemas[0] ?? "public";
  if (schemas.length > 1 || !/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
    throw new Error("PostgreSQL schema 需为 1–63 位小写字母、数字或下划线，且不能以数字开头。");
  url.searchParams.delete("schema");
  return {
    schema,
    pool: {
      connectionString: url.toString(),
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    },
  };
}

module.exports = { postgresOptions };
