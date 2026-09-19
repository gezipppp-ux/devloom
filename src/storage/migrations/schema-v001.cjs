exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','member')),
      status TEXT NOT NULL CHECK (status IN ('active','disabled')),
      must_change_password INTEGER NOT NULL DEFAULT 0,
      auth_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  await knex.schema.createTable("auth_sessions", (table) => {
    table.text("sid").primary();
    table.text("session_json").notNullable();
    table.bigInteger("expires_at").notNullable().index();
    table.text("user_id").references("id").inTable("users").onDelete("CASCADE").index();
  });
  await knex.schema.createTable("auth_metadata", (table) => {
    table.text("name").primary();
    table.text("value").notNullable();
  });
  await knex.schema.createTable("user_settings", (table) => {
    table.text("user_id").primary().references("id").inTable("users").onDelete("CASCADE");
    table.text("model");
    table.text("reasoning_effort");
    table.text("permission_mode").notNullable().defaultTo("ask");
    table.integer("notifications_enabled").notNullable().defaultTo(1);
    table.text("grouping").notNullable().defaultTo("type");
    table.text("data").notNullable().defaultTo("{}");
    table.text("updated_at").notNullable();
  });
  await knex.schema.createTable("system_settings", (table) => {
    table.text("key").primary();
    table.text("value").notNullable();
    table.text("updated_at").notNullable();
  });
  await knex.schema.createTable("workspaces", (table) => {
    table.text("id").primary();
    table.text("owner_user_id").notNullable().references("id").inTable("users");
    table.text("name").notNullable();
    table.text("icon");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.unique(["owner_user_id", "name"]);
  });
  await knex.schema.createTable("workspace_settings", (table) => {
    table.text("workspace_id").primary().references("id").inTable("workspaces").onDelete("CASCADE");
    table.text("data").notNullable();
    table.text("updated_at").notNullable();
  });
  await knex.schema.createTable("user_preferences", (table) => {
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("workspace_id").notNullable().references("id").inTable("workspaces").onDelete("CASCADE");
    table.text("data").notNullable().defaultTo("{}");
    table.primary(["user_id", "workspace_id"]);
  });
  await knex.schema.createTable("runs", (table) => {
    table.text("path").primary();
    table.text("workspace_id").references("id").inTable("workspaces").index();
    table.text("owner_user_id").references("id").inTable("users");
    table.text("run_key").notNullable();
    table.text("session_id").index();
    table.text("execution_state");
    table.text("source_json");
    table.text("data").notNullable();
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.unique(["workspace_id", "run_key"]);
  });
  await knex.schema.createTable("run_documents", (table) => {
    table.text("path").primary();
    table.text("workspace_id").references("id").inTable("workspaces").index();
    table.text("run_key");
    table.text("name").notNullable();
    table.text("data").notNullable();
    table.text("updated_at").notNullable();
  });
  await knex.schema.createTable("documents", (table) => {
    table.text("path").primary();
    table.text("data").notNullable();
    table.text("updated_at").notNullable();
  });
  await knex.schema.createTable("attachments", (table) => {
    table.text("path").primary();
    table.text("workspace_id").references("id").inTable("workspaces").index();
    table.text("run_key");
    table.text("mime_type").notNullable();
    table.integer("size").notNullable();
    table.text("sha256").notNullable();
    table.binary("data").notNullable();
    table.text("metadata_json").notNullable();
    table.text("created_at").notNullable();
    table.text("expires_at").index();
  });
  await knex.schema.createTable("session_items", (table) => {
    table.increments("id");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.text("run_path").notNullable();
    table.text("item_id").notNullable();
    table.text("turn_id");
    table.text("data").notNullable();
    table.text("updated_at");
    table.unique(["run_path", "item_id"]);
    table.index(["run_path", "sort_order", "id"]);
  });
  await knex.schema.createTable("log_chunks", (table) => {
    table.increments("id");
    table.text("path").notNullable();
    table.binary("data").notNullable();
    table.text("created_at").notNullable();
    table.index(["path", "id"]);
  });
  await knex.schema.createTable("audit_events", (table) => {
    table.increments("id");
    table.text("event").notNullable();
    table.text("actor_user_id").references("id").inTable("users");
    table.text("workspace_id").references("id").inTable("workspaces");
    table.text("details_json").notNullable().defaultTo("{}");
    table.text("created_at").notNullable().index();
  });
};

exports.down = async function down() {
  throw new Error("生产数据库不支持自动降级；请停止服务后恢复升级前备份。");
};
