const { AccountStore } = require("../storage/account-store.cjs");
const { AuthSessionStore } = require("../storage/auth-session-store.cjs");
const { AppServerClient } = require("../codex/app-server-client.cjs");
const { listModels } = require("../codex/models.cjs");
const { permissionOptions } = require("../codex/permissions.cjs");
const { initializeDatabase } = require("../storage/database-lifecycle.cjs");
const {
  accountError,
  username,
  accountSettings,
  validateAccountCreation,
  validateAccountUpdate,
  validateAccountPreferences,
} = require("../domain/account.cjs");
const {
  hashPassword,
  verifyPassword,
} = require("../storage/account-passwords.cjs");
const { publicAccount } = require("./account-presenter.cjs");

class AccountServices {
  constructor(database) {
    this.database = database;
    this.store = new AccountStore(database);
    this.sessions = new AuthSessionStore(database);
    this.client = new AppServerClient();
  }
  actor(session) {
    if (!session?.userId) return null;
    const row = this.store.byId(session.userId);
    if (
      !row ||
      row.status !== "active" ||
      row.auth_version !== session.authVersion ||
      !session.sessionId ||
      !this.sessions.valid(session.sessionId, row.id) ||
      (session.absoluteExpiresAt && session.absoluteExpiresAt <= Date.now())
    )
      return null;
    return publicAccount(row);
  }
  requireAdmin(actor) {
    const current = actor && this.store.byId(actor.id);
    if (!current || current.role !== "admin" || current.status !== "active")
      throw accountError("仅管理员可操作。", 403);
  }
  async login(input) {
    let row;
    try {
      row = this.store.byUsername(username(input.username));
    } catch {
      /* Uniform failure. */
    }
    // A fixed valid hash equalizes expensive verification for unknown accounts.
    const encoded =
      row?.password_hash ||
      "scrypt$16384$8$1$00000000000000000000000000000000$" + "00".repeat(64);
    if (
      !(await verifyPassword(input.password, encoded)) ||
      row?.status !== "active"
    )
      throw accountError("账号或密码错误。", 401);
    const latest = this.store.byId(row.id);
    if (latest.status !== "active" || latest.auth_version !== row.auth_version)
      throw accountError("账号或密码错误。", 401);
    return row;
  }
  async create(input, actor, initial = false, authorize) {
    if (!initial) this.requireAdmin(actor);
    const validated = validateAccountCreation(input, { initial });
    const encoded = await hashPassword(validated.password);
    authorize?.();
    if (!initial) this.requireAdmin(actor);
    const row = this.store.create(
      {
        username: validated.username,
        password_hash: encoded,
        role: validated.role,
        must_change_password: !initial,
      },
      { initial },
    );
    return publicAccount(row);
  }
  async update(id, input, actor, authorize) {
    this.requireAdmin(actor);
    input = validateAccountUpdate(input);
    const patch = {};
    if (input.role !== undefined) {
      patch.role = input.role;
    }
    if (input.status !== undefined) {
      patch.status = input.status;
    }
    if (input.password !== undefined) {
      patch.password_hash = await hashPassword(input.password);
      patch.must_change_password = 1;
    }
    authorize?.();
    this.requireAdmin(actor);
    return publicAccount(this.store.update(id, patch));
  }
  async changePassword(actor, input, authorize) {
    const row = this.store.byId(actor.id);
    if (!(await verifyPassword(input.currentPassword, row.password_hash)))
      throw accountError("当前密码错误。", 400);
    const passwordHash = await hashPassword(input.password);
    authorize?.();
    if (this.store.byId(actor.id).auth_version !== row.auth_version)
      throw accountError("账号状态已变更，请重新登录。", 401);
    return this.store.update(actor.id, {
      password_hash: passwordHash,
      must_change_password: 0,
    });
  }
  describe(row) {
    return publicAccount(row);
  }
  audit(actor, event, workspaceId, details) {
    this.store.audit(actor, event, workspaceId, details);
  }
  listModels() {
    return listModels(this.client);
  }
  async executionOptions() {
    return { permissionModes: await permissionOptions(this.client) };
  }
  close() {
    return this.client.close();
  }
  sessionSecret() {
    return this.sessions.signingSecret();
  }
  sessionStore() {
    return this.sessions;
  }
  sessionValid(sessionId, userId) {
    return this.sessions.valid(sessionId, userId);
  }
  closeDatabase() {
    this.database.close();
  }
  list(actor) {
    this.requireAdmin(actor);
    return this.store.list().map(publicAccount);
  }
  settings(actor) {
    return this.store.settings(actor.id);
  }
  saveSettings(actor, input) {
    return this.store.saveSettings(
      actor.id,
      accountSettings(input, this.settings(actor)),
    );
  }
  preferences(actor, id) {
    return this.store.preferences(actor.id, id);
  }
  savePreferences(actor, id, input) {
    return this.store.savePreferences(
      actor.id,
      id,
      validateAccountPreferences(input),
    );
  }
}
async function initializeAccountServices(directory) {
  return new AccountServices(await initializeDatabase(directory));
}
module.exports = { AccountServices, initializeAccountServices };
