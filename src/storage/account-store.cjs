const { randomUUID } = require("node:crypto");
const {
  accountError,
  DEFAULT_ACCOUNT_SETTINGS,
} = require("../domain/account.cjs");

class AccountStore {
  constructor(database) {
    this.db = database.handle;
  }
  count() {
    return this.db.prepare("SELECT count(*) AS count FROM users").get().count;
  }
  byId(id) {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  }
  byUsername(name) {
    return this.db.prepare("SELECT * FROM users WHERE username = ?").get(name);
  }
  list() {
    return this.db.prepare("SELECT * FROM users ORDER BY username").all();
  }
  create(input, { initial = false } = {}) {
    return this.db
      .transaction(() => {
        if (initial && this.count())
          throw accountError("管理员已初始化，请使用账号重置命令。", 409);
        if (this.byUsername(input.username))
          throw accountError("账号已存在。", 409);
        const row = {
          id: randomUUID(),
          ...input,
          status: "active",
          must_change_password: input.must_change_password ? 1 : 0,
          auth_version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.db
          .prepare(
            "INSERT INTO users (id,username,password_hash,role,status,must_change_password,auth_version,created_at,updated_at) VALUES (@id,@username,@password_hash,@role,@status,@must_change_password,@auth_version,@created_at,@updated_at)",
          )
          .run(row);
        return this.byId(row.id);
      })
      .immediate();
  }
  update(id, patch) {
    return this.db
      .transaction(() => {
        const current = this.byId(id);
        if (!current) throw accountError("账号不存在。", 404);
        const next = {
          ...current,
          ...patch,
          updated_at: new Date().toISOString(),
          auth_version: current.auth_version + 1,
        };
        if (
          current.role === "admin" &&
          current.status === "active" &&
          (next.role !== "admin" || next.status !== "active")
        ) {
          const active = this.db
            .prepare(
              "SELECT count(*) AS count FROM users WHERE role='admin' AND status='active'",
            )
            .get().count;
          if (active <= 1)
            throw accountError("不能停用或降级最后一个有效管理员。", 409);
        }
        this.db
          .prepare(
            "UPDATE users SET password_hash=@password_hash,role=@role,status=@status,must_change_password=@must_change_password,auth_version=@auth_version,updated_at=@updated_at WHERE id=@id",
          )
          .run(next);
        this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(id);
        return this.byId(id);
      })
      .immediate();
  }
  settings(id) {
    const row = this.db
      .prepare("SELECT * FROM user_settings WHERE user_id=?")
      .get(id);
    if (!row) return { ...DEFAULT_ACCOUNT_SETTINGS };
    return {
      model: row.model ?? null,
      reasoningEffort: row.reasoning_effort ?? null,
      permissionMode: row.permission_mode || "ask",
      notificationsEnabled: Boolean(row.notifications_enabled),
      grouping: row.grouping || "type",
    };
  }
  saveSettings(id, value) {
    this.db
      .prepare(
        "INSERT INTO user_settings(user_id,model,reasoning_effort,permission_mode,notifications_enabled,grouping,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET model=excluded.model,reasoning_effort=excluded.reasoning_effort,permission_mode=excluded.permission_mode,notifications_enabled=excluded.notifications_enabled,grouping=excluded.grouping,updated_at=excluded.updated_at",
      )
      .run(
        id,
        value.model,
        value.reasoningEffort,
        value.permissionMode,
        value.notificationsEnabled ? 1 : 0,
        value.grouping,
        new Date().toISOString(),
      );
    return this.settings(id);
  }
  preferences(id, workspaceId) {
    const row = this.db
      .prepare(
        "SELECT data FROM user_preferences WHERE user_id=? AND workspace_id=?",
      )
      .get(id, workspaceId);
    return row ? JSON.parse(row.data) : { unreadRunKeys: [] };
  }
  audit(actor, event, workspaceId, details = {}) {
    this.db
      .prepare(
        "INSERT INTO audit_events(event,actor_user_id,workspace_id,details_json,created_at) VALUES (?,?,?,?,?)",
      )
      .run(
        event,
        actor?.id || null,
        workspaceId || null,
        JSON.stringify(details),
        new Date().toISOString(),
      );
  }
  savePreferences(id, workspaceId, value) {
    this.db
      .prepare(
        "INSERT INTO user_preferences(user_id,workspace_id,data) VALUES (?,?,?) ON CONFLICT(user_id,workspace_id) DO UPDATE SET data=excluded.data",
      )
      .run(id, workspaceId, JSON.stringify(value));
    return value;
  }
}
module.exports = { AccountStore };
