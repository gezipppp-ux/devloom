exports.up = async function up(knex) {
  await knex.schema.createTable("user_git_accounts", (table) => {
    table.text("id").primary();
    table
      .text("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE")
      .index();
    table.text("name").notNullable();
    table.text("auth_type").notNullable();
    table.text("remote_url").notNullable();
    table.integer("revision").notNullable().defaultTo(1);
    table.text("credentials").notNullable();
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.unique(["user_id", "name"]);
  });
  await knex.schema.createTable("git_key_drafts", (table) => {
    table.text("id").primary();
    table
      .text("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.text("credentials").notNullable();
    table.bigInteger("expires_at").notNullable();
  });
};

exports.down = async function down() {
  throw new Error("生产数据库不支持自动降级；请停止服务后恢复升级前备份。");
};
