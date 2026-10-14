const { AccountStore } = require("../storage/account-store.cjs");
const { AuthSessionStore } = require("../storage/auth-session-store.cjs");
const { AgentSessionManager } = require("./agent-session-manager.cjs");
const { AgentSupplierStore } = require("../storage/agent-supplier-store.cjs");
const { describeAgent } = require("./agent-presenter.cjs");
const { initializeDatabase } = require("../storage/database-lifecycle.cjs");
const {
  accountError,
  username,
  accountSettings,
  validateAccountCreation,
  validateAccountUpdate,
  validateAccountProfile,
  validateAccountPreferences,
} = require("../domain/account.cjs");
const {
  hashPassword,
  verifyPassword,
} = require("../storage/account-passwords.cjs");
const { publicAccount } = require("./account-presenter.cjs");

class AccountServices {
  constructor(database, { agent } = {}) {
    this.database = database;
    this.store = new AccountStore(database);
    this.sessions = new AuthSessionStore(database);
    this.agent = agent || new AgentSessionManager({ store: new AgentSupplierStore(database) });
  }
  async actor(session) {
    if (!session?.userId) return null;
    const row = (await this.store.byId(session.userId));
    if (
      !row ||
      row.status !== "active" ||
      row.auth_version !== session.authVersion ||
      !session.sessionId ||
      !(await this.sessions.valid(session.sessionId, row.id)) ||
      (session.absoluteExpiresAt && session.absoluteExpiresAt <= Date.now())
    )
      return null;
    return publicAccount(row);
  }
  async requireAdmin(actor) {
    const current = actor && (await this.store.byId(actor.id));
    if (!current || current.role !== "admin" || current.status !== "active")
      throw accountError("仅管理员可操作。", 403);
  }
  async login(input) {
    let row;
    try {
      row = (await this.store.byUsername(username(input.username)));
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
    const latest = (await this.store.byId(row.id));
    if (latest.status !== "active" || latest.auth_version !== row.auth_version)
      throw accountError("账号或密码错误。", 401);
    return row;
  }
  async create(input, actor, initial = false, authorize) {
    if (!initial) (await this.requireAdmin(actor));
    const prepared = await this.prepareCreation(input, initial);
    await authorize?.();
    return this.createPrepared(prepared, actor, initial);
  }
  async prepareCreation(input, initial = false) {
    const validated = validateAccountCreation(input, { initial });
    return {
      username: validated.username, displayName: validated.displayName,
      password_hash: await hashPassword(validated.password), role: validated.role,
      must_change_password: !initial, departmentId: validated.departmentId,
      canCreateProjects: validated.canCreateProjects,
    };
  }
  async createPrepared(prepared, actor, initial = false) {
    if (!initial) (await this.requireAdmin(actor));
    const row = (await this.store.create(
      prepared,
      { initial },
    ));
    return publicAccount(row);
  }
  async update(id, input, actor, authorize) {
    (await this.requireAdmin(actor));
    input = validateAccountUpdate(input, { currentRole: (await this.store.byId(id))?.role });
    const patch = {};
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.departmentId !== undefined) patch.departmentId = input.departmentId;
    if (input.canCreateProjects !== undefined) patch.canCreateProjects = input.canCreateProjects;
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
    await authorize?.();
    (await this.requireAdmin(actor));
    return publicAccount((await this.store.update(id, patch)));
  }
  async changePassword(actor, input, authorize) {
    const row = (await this.store.byId(actor.id));
    if (!(await verifyPassword(input.currentPassword, row.password_hash)))
      throw accountError("当前密码错误。", 400);
    const passwordHash = await hashPassword(input.password);
    await authorize?.();
    if ((await this.store.byId(actor.id)).auth_version !== row.auth_version)
      throw accountError("账号状态已变更，请重新登录。", 401);
    return (await this.store.update(actor.id, {
      password_hash: passwordHash,
      must_change_password: 0,
    }));
  }
  async updateProfile(actor, input, authorize) {
    const patch = validateAccountProfile(input);
    await authorize?.();
    return publicAccount(await this.store.update(actor.id, patch));
  }
  describe(row) {
    return publicAccount(row);
  }
  async audit(actor, event, workspaceId, details) {
    (await this.store.audit(actor, event, workspaceId, details));
  }
  async listModels() {
    return (await this.agent.listModels());
  }
  async executionOptions() {
    return { agent: describeAgent(this.agent), permissionModes: await this.agent.permissionOptions(),
      ...(this.agent.currentSummary ? { nextSupplier: await this.agent.currentSummary() } : {}) };
  }
  async close() {
    return (await this.agent.close());
  }
  async sessionSecret() {
    return (await this.sessions.signingSecret());
  }
  sessionStore() {
    return this.sessions;
  }
  async sessionValid(sessionId, userId) {
    return (await this.sessions.valid(sessionId, userId));
  }
  async closeDatabase() {
    return await this.database.close();
  }
  async list(actor) {
    (await this.requireAdmin(actor));
    return (await this.store.list()).map(publicAccount);
  }
  async settings(actor) {
    return (await this.store.settings(actor.id));
  }
  async saveSettings(actor, input) {
    return (await this.store.saveSettings(
      actor.id,
      accountSettings(input, (await this.settings(actor))),
    ));
  }
  async preferences(actor, id) {
    return (await this.store.preferences(actor.id, id));
  }
  async savePreferences(actor, id, input) {
    return (await this.store.savePreferences(
      actor.id,
      id,
      validateAccountPreferences(input),
    ));
  }
}
async function initializeAccountServices(directory, options) {
  return new AccountServices(await initializeDatabase(directory, options));
}
module.exports = { AccountServices, initializeAccountServices };
