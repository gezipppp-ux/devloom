const { accountError, DEFAULT_ACCOUNT_SETTINGS } = require("../domain/account.cjs");
const { projectContextPermissions, ownerPermissions } = require("../domain/project-permissions.cjs");
const { SETUP_ID } = require("../domain/setup-state.cjs");

// Internal account record contract shared with password and authentication
// services. Public response shaping remains in account-presenter.
function accountRecord(row) {
  if (!row) return undefined;
  return {
    id: row.id, username: row.username, displayName: row.displayName, password_hash: row.passwordHash,
    role: row.role, status: row.status, must_change_password: row.mustChangePassword,
    departmentId: row.departmentId, canCreateProjects: row.canCreateProjects,
    auth_version: row.authVersion, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
  };
}

class AccountStore {
  constructor(database) { this.database = database; }

  async count() { return this.database.client.user.count(); }
  async byId(id) { return accountRecord(await this.database.client.user.findUnique({ where: { id } })); }
  async byUsername(username) { return accountRecord(await this.database.client.user.findUnique({ where: { username } })); }
  async list() { return (await this.database.client.user.findMany({ orderBy: { username: "asc" } })).map(accountRecord); }

  async create(input, { initial = false } = {}) {
    if (input.role === "admin") input = { ...input, departmentId: null, canCreateProjects: false };
    try {
      return await this.database.transaction(async () => {
        if (initial && await this.count()) throw accountError("管理员已初始化。", 409);
        if (input.departmentId && !(await this.database.client.department.findFirst({ where: { id: input.departmentId, status: "active" } }))) throw accountError("部门不存在或已停用。");
        const row = await this.database.client.user.create({ data: {
          username: input.username, displayName: input.displayName, passwordHash: input.password_hash,
          role: input.role, mustChangePassword: Boolean(input.must_change_password),
          departmentId: input.departmentId || null, canCreateProjects: Boolean(input.canCreateProjects),
        } });
        if (initial) await this.database.client.systemSetup.updateMany({ where: { id: SETUP_ID, status: "awaiting_admin" }, data: {
          status: "pending", initialAdminId: row.id, steps: { admin: { status: "completed" } },
          revision: { increment: 1 },
        } });
        return accountRecord(row);
      });
    } catch (error) {
      if (error.code === "P2002") throw accountError("账号已存在。", 409);
      if (error.code === "P2034") throw accountError("账号数据已变更，请刷新后重试。", 409);
      throw error;
    }
  }

  async update(id, patch) {
    try {
      return await this.database.transaction(async () => {
        const current = await this.byId(id);
        if (!current) throw accountError("账号不存在。", 404);
        const next = { ...current, ...patch };
        if (next.role === "admin") { next.departmentId = null; next.canCreateProjects = false; }
        const authenticationChanged = Object.keys(patch).some(key => key !== "displayName");
        if (next.role !== "admin" && patch.departmentId && !(await this.database.client.department.findFirst({ where: { id: patch.departmentId, status: "active" } }))) throw accountError("部门不存在或已停用。");
        if ((patch.departmentId !== undefined && patch.departmentId !== current.departmentId) ||
            (patch.role !== undefined && patch.role !== current.role)) {
          const department = next.departmentId && await this.database.client.department.findUnique({ where: { id: next.departmentId } });
          const owned = await this.database.client.project.findMany({ where: { ownerUserId: id },
            select: { id: true, members: { where: { userId: id }, select: { userId: true, projectId: true, status: true, permissions: true } } } });
          if (owned.some(project => {
            const member = project.members[0];
            const effective = projectContextPermissions({ user: next, department, membership: member, project });
            return !ownerPermissions.every(permission => effective.includes(permission));
          })) throw accountError("账号变更后不能保留项目负责人的查看、配置和成员管理权限，请先指定接任人。", 409);
        }
        if (next.status !== "active" && await this.database.client.project.count({ where: { ownerUserId: id } })) throw accountError("该账号仍为项目负责人，请先指定接任人。", 409);
        if (current.role === "admin" && current.status === "active" &&
            (next.role !== "admin" || next.status !== "active") &&
            await this.database.client.user.count({ where: { role: "admin", status: "active" } }) <= 1)
          throw accountError("不能停用或降级最后一个有效管理员。", 409);
        const row = await this.database.client.user.update({ where: { id }, data: {
          displayName: next.displayName, passwordHash: next.password_hash, role: next.role, status: next.status,
          mustChangePassword: Boolean(next.must_change_password), ...(authenticationChanged ? { authVersion: { increment: 1 } } : {}),
          departmentId: next.departmentId, canCreateProjects: Boolean(next.canCreateProjects),
        } });
        if (next.role === "admin" && current.role !== "admin") await this.database.client.projectMember.updateMany({
          where: { userId: id }, data: { permissions: [], revision: { increment: 1 } },
        });
        if (authenticationChanged) await this.database.client.authSession.deleteMany({ where: { userId: id } });
        return accountRecord(row);
      });
    } catch (error) {
      if (error.code === "P2034") throw accountError("账号数据已变更，请刷新后重试。", 409);
      throw error;
    }
  }

  async settings(userId) {
    const row = await this.database.client.userSetting.findUnique({ where: { userId } });
    if (!row) return { ...DEFAULT_ACCOUNT_SETTINGS };
    return { model: row.model, reasoningEffort: row.reasoningEffort, permissionMode: row.permissionMode,
      notificationsEnabled: row.notificationsEnabled, grouping: row.grouping };
  }

  async saveSettings(userId, value) {
    const data = { model: value.model, reasoningEffort: value.reasoningEffort, permissionMode: value.permissionMode,
      notificationsEnabled: value.notificationsEnabled, grouping: value.grouping };
    await this.database.client.userSetting.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return (await this.settings(userId));
  }

  async preferences(userId, workspaceId) {
    return (await this.database.client.userPreference.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } }))?.data || { unreadRunKeys: [] };
  }

  async savePreferences(userId, workspaceId, data) {
    await this.database.client.userPreference.upsert({ where: { userId_workspaceId: { userId, workspaceId } },
      create: { userId, workspaceId, data }, update: { data } });
    return data;
  }

  async audit(actor, event, workspaceId, details = {}) {
    await this.database.client.auditEvent.create({ data: {
      event, actorUserId: actor?.id || null, workspaceId: workspaceId || null, details,
    } });
  }
}

module.exports = { AccountStore };
