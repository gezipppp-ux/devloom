exports.up = async function up(knex) {
  await knex.schema.createTable("workspace_clones", table => {
    table.text("id").primary();
    table.text("owner_user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("request_id").notNullable();
    table.text("input_json").notNullable();
    table.text("status").notNullable();
    table.text("progress_json").notNullable();
    table.text("workspace_json");
    table.text("error");
    table.integer("worker_pid").notNullable();
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.text("dismissed_at");
    table.unique(["owner_user_id", "request_id"]);
    table.index(["owner_user_id", "dismissed_at"]);
  });
};

exports.down = async function down() {
  throw new Error("生产数据库不支持自动降级；请停止服务后恢复升级前备份。");
};
