const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { ProjectStore } = require("../storage/project-store.cjs");
const { GitAccountStore } = require("../storage/git-account-store.cjs");
const { accountError } = require("../domain/account.cjs");
const { departmentInput, repositoryInput, projectInput, memberInput, prepareSpaceInput, projectId, projectRevision } = require("../domain/project-input.cjs");
const { assertProjectPermission, effectivePermissions, validatePermissions, canCreateProject, projectCreationReadiness, projectPermissionCatalog, productTemplate, developerTemplate } = require("../domain/project-permissions.cjs");
const { remoteHost, remoteAuthType } = require("../domain/git-account.cjs");
const { readSystemSettings } = require("../config/system-settings.cjs");
const { cloneProject } = require("../git/project-clone.cjs");
const { testGitConnection } = require("../git/account-credentials.cjs");
const { buildSession, parseCookieHeader, todoRequest } = require("../channels/tapd/auth-utils.cjs");
const { defaultChannelConfig } = require("../channels/channel-registry.cjs");
const { presentDepartment, presentRepository, presentProject, presentMember, presentSpace } = require("./project-presenter.cjs");
const { presentError } = require("./error-presenter.cjs");

class ProjectServices {
  constructor(database, { workspaces, clone = cloneProject, checkConnection = testGitConnection, onRevoke = () => {} } = {}) {
    this.store = new ProjectStore(database);
    this.gitAccounts = new GitAccountStore(database);
    this.workspaces = workspaces;
    this.clone = clone;
    this.checkConnection = checkConnection;
    this.onRevoke = onRevoke;
    this.active = new Map();
    this.closed = false;
  }
  async initialize() {
    await this.store.recoverSpaces();
    this.timer = setInterval(() => {
      this.enforcing ||= this.enforce().catch(() => {}).finally(() => { this.enforcing = null; });
    }, 1000);
    this.timer.unref?.();
  }
  catalog() { return { permissions: projectPermissionCatalog, templates: { product: productTemplate, developer: developerTemplate } }; }
  async currentUser(actor) {
    const user = actor?.id && await this.store.user(actor.id);
    if (!user || user.status !== "active") throw accountError("请先登录。", 401, "AUTH_REQUIRED");
    return user;
  }
  async admin(actor) {
    const user = await this.currentUser(actor);
    if (user.role !== "admin") throw accountError("仅管理员可操作。", 403);
    return user;
  }
  async authorize(id, actor, permission) {
    const user = await this.currentUser(actor);
    const project = await this.store.project(projectId(id));
    const membership = await this.store.membership(id, user.id);
    const context = { user, department: user.department, project, membership };
    assertProjectPermission(context, permission);
    return { ...context, permissions: effectivePermissions(user.department.permissions, membership.permissions) };
  }
  async departments(actor) { await this.admin(actor); return { departments: (await this.store.departments()).map(presentDepartment) }; }
  async saveDepartment(actor, input, id) {
    const value = departmentInput(input, Boolean(id));
    if (id) projectId(id);
    const saved = await this.store.transaction(async () => {
      await this.admin(actor);
      const row = await this.store.saveCatalog("department", value, id);
      await this.store.audit(actor, "department.saved", { departmentId: row.id, revision: row.revision });
      return row;
    });
    await this.enforce();
    return { department: presentDepartment(saved) };
  }
  async repositories(actor, adminOnly = true) {
    if (adminOnly) await this.admin(actor);
    else {
      const user = await this.currentUser(actor);
      if (!canCreateProject(user, user.department)) throw accountError("未获得创建项目资格。", 403);
    }
    return { repositories: (await this.store.repositories()).filter(row => adminOnly || row.status === "active").map(presentRepository) };
  }
  async saveRepository(actor, input, id) {
    const value = repositoryInput(input, Boolean(id));
    if (id) projectId(id);
    return this.store.transaction(async () => {
      await this.admin(actor);
      const previous = id && await this.store.repository(id);
      if (previous && value.remoteUrl && value.remoteUrl !== previous.remoteUrl && await this.store.repositoryUsed(id))
        throw accountError("仓库已关联开发空间，不能更改远程地址。", 409);
      const row = await this.store.saveCatalog("repository", value, id);
      await this.store.audit(actor, "repository.saved", { repositoryId: row.id, revision: row.revision });
      return { repository: presentRepository(row) };
    });
  }
  async list(actor) {
    const user = await this.currentUser(actor);
    const projects = [];
    for (const project of await this.store.projects(user.id)) {
      const membership = await this.store.membership(project.id, user.id);
      const permissions = user.department?.status === "active" ? effectivePermissions(user.department.permissions, membership.permissions) : [];
      if (!permissions.includes("project.view")) continue;
      projects.push({ ...presentProject(project, permissions), permissions, membership: presentMember(membership), space: presentSpace(await this.store.space(project.id, user.id)) });
    }
    const canCreateProjects = Boolean(canCreateProject(user, user.department) && user.department?.status === "active");
    const departments = canCreateProjects ? (await this.store.departments()).filter(row => row.status === "active" && (user.role === "admin" || row.id === user.departmentId)).map(row => ({ id: row.id, name: row.name })) : [];
    const setup = user.role === "admin" ? { hasDepartments: (await this.store.departments()).some(row => row.status === "active"), departmentAssigned: user.department?.status === "active", hasRepositories: (await this.store.repositories()).some(row => row.status === "active") } : undefined;
    return { projects, setup, canCreateProjects, creationReadiness: projectCreationReadiness(user, user.department), isAdmin: user.role === "admin", departmentId: user.departmentId, departments };
  }
  async read(id, actor) {
    const { project, membership, permissions, department } = await this.authorize(id, actor, "project.view");
    return { permissionContext: { departmentName: department.name, ceiling: department.permissions, grants: membership.permissions }, project: presentProject(project, permissions), membership: presentMember(membership), permissions, space: presentSpace(await this.store.space(id, actor.id)) };
  }
  settings(input = {}, previous = {}) {
    const value = { ...previous, ...input };
    if (input.prompts) {
      value.prompts = { ...previous.prompts };
      for (const [channel, template] of Object.entries(input.prompts)) {
        if (template === null) delete value.prompts[channel];
        else value.prompts[channel] = template;
      }
    }
    if (input.tapd) {
      const draft = input.tapd;
      const cookie = draft.clearCookie ? "" : draft.cookie?.trim() || previous.tapd?.session?.cookie_header || "";
      const dscToken = cookie ? parseCookieHeader(cookie)["dsc-token"] : "";
      if (cookie && !dscToken) throw accountError("Cookie 必须包含 dsc-token。");
      value.tapd = { image_hosts: draft.imageHosts ?? previous.tapd?.image_hosts ?? [],
        session: buildSession({ cookieHeader: cookie, requestBody: todoRequest({ workspaceId: draft.workspaceId, dscToken }), referer: "https://www.tapd.cn/tapd_fe/my/work?left_tree=1" }) };
    }
    return value;
  }
  async create(actor, input) {
    const value = projectInput(input);
    const row = await this.store.transaction(async () => {
      const user = await this.currentUser(actor);
      if (!canCreateProject(user, user.department) || user.department?.status !== "active") throw accountError("未获得创建项目资格或尚未分配有效部门。", 403);
      if (user.role !== "admin" && value.departmentId !== user.departmentId) throw accountError("只能在本人所属部门创建项目。", 403);
      if ((await this.store.department(value.departmentId))?.status !== "active") throw accountError("请选择有效部门。");
      if ((await this.store.repository(value.repositoryId))?.status !== "active") throw accountError("请选择启用的仓库。");
      const permissions = validatePermissions(["project.view", "project.configure", "project.members.manage"], { scope: "project", ceiling: user.department.permissions });
      const project = await this.store.saveProject({ ...value, settings: this.settings(value.settings), ownerUserId: user.id });
      await this.store.saveMember(project.id, user.id, { permissions, status: "active" }, false);
      await this.store.audit(actor, "project.created", { projectId: project.id });
      return project;
    });
    return this.read(row.id, actor);
  }
  async update(id, actor, input) {
    const value = projectInput(input, true);
    await this.store.transaction(async () => {
      const { project } = await this.authorize(id, actor, "project.configure");
      if (value.departmentId && value.departmentId !== project.departmentId) throw accountError("项目归属部门不能更改。");
      if (value.repositoryId && value.repositoryId !== project.repositoryId) {
        if (await this.store.spaceCount(id)) throw accountError("项目已分配开发空间，不能更换仓库。", 409);
        if ((await this.store.repository(value.repositoryId))?.status !== "active") throw accountError("请选择启用的仓库。");
      }
      if (value.ownerUserId && value.ownerUserId !== project.ownerUserId) {
        await this.authorize(id, actor, "project.members.manage");
        const owner = await this.store.user(value.ownerUserId);
        const member = await this.store.membership(id, value.ownerUserId);
        const effective = effectivePermissions(owner?.department?.permissions, member?.permissions);
        if (owner?.status !== "active" || owner.department?.status !== "active" || member?.status !== "active" || !["project.view", "project.configure", "project.members.manage"].every(permission => effective.includes(permission)))
          throw accountError("接任负责人须为有效成员并拥有项目配置和成员管理权限。");
      }
      if (value.settings) value.settings = this.settings(value.settings, project.settings);
      const saved = await this.store.saveProject(value, id);
      await this.syncSpaces(saved);
      await this.store.audit(actor, "project.updated", { projectId: id, revision: saved.revision });
    });
    return this.read(id, actor);
  }
  async members(id, actor) {
    const context = await this.authorize(id, actor, "project.view");
    const result = { members: (await this.store.members(id)).map(presentMember) };
    if (context.permissions.includes("project.members.manage")) result.candidates = (await this.store.users()).map(user => ({ id: user.id, username: user.username, departmentId: user.departmentId, departmentName: user.department?.name || "", permissions: user.department?.status === "active" ? user.department.permissions : [] }));
    return result;
  }
  async saveMember(id, actor, input, userId) {
    const updating = Boolean(userId);
    const value = memberInput(input, updating);
    userId = projectId(userId || value.userId);
    const row = await this.store.transaction(async () => {
      const { project } = await this.authorize(id, actor, "project.members.manage");
      const user = await this.store.user(userId);
      if (!user || user.status !== "active" || user.department?.status !== "active") throw accountError("请选择已分配有效部门的账号。");
      value.permissions = validatePermissions(value.permissions, { scope: "project", ceiling: user.department.permissions });
      const memberStatus = value.status || (updating ? (await this.store.membership(id, userId))?.status : "active");
      if (memberStatus !== "disabled" && !value.permissions.includes("project.view")) throw accountError("参与中的成员必须拥有查看项目权限；请先检查部门上限并授予查看项目权限。", 400, "PROJECT_VIEW_REQUIRED");
      if (project.ownerUserId === userId && (value.status === "disabled" || !["project.view", "project.configure", "project.members.manage"].every(permission => value.permissions.includes(permission))))
        throw accountError("请先指定接任负责人，再移除或减少原负责人权限。", 409);
      const membership = await this.store.saveMember(id, userId, value, updating);
      if (membership.status === "active" && value.permissions.includes("code.operate")) await this.store.allocateSpace(id, userId);
      await this.store.audit(actor, "project.member.saved", { projectId: id, userId, revision: membership.revision });
      return membership;
    });
    await this.enforce();
    return { membership: presentMember(row), space: presentSpace(await this.store.space(id, userId)) };
  }
  async archive(id, actor, input, restore = false) {
    const revision = projectRevision(input?.revision);
    await this.store.transaction(async () => {
      const context = await this.authorize(id, actor, "project.view");
      assertProjectPermission({ ...context, project: { ...context.project, status: "active" } }, "project.archive");
      await this.store.saveProject({ revision, status: restore ? "active" : "archived" }, id);
      await this.store.audit(actor, restore ? "project.restored" : "project.archived", { projectId: id });
    });
    await this.enforce();
    return this.read(id, actor);
  }
  async space(id, actor) {
    await this.authorize(id, actor, "code.view");
    return { space: presentSpace(await this.store.space(id, actor.id)) };
  }
  async workspaceAuthorization(workspaceId, actor, permission) {
    const space = await this.store.workspaceSpace(workspaceId);
    if (!space || space.userId !== actor?.id || space.status !== "ready") throw accountError("开发空间不存在或未就绪。", 404);
    return { ...await this.authorize(space.projectId, actor, permission), space };
  }
  async prepare(id, actor, input) {
    if (this.closed) throw accountError("服务正在关闭。", 503);
    const value = prepareSpaceInput(input);
    const context = await this.authorize(id, actor, "code.operate");
    const account = await this.gitAccounts.read(value.gitAccountId, actor.id);
    const remote = context.project.repository.remoteUrl;
    if (context.project.repository.status !== "active" || account.host !== remoteHost(remote) || account.authType !== remoteAuthType(remote)) throw accountError("Git 账号主机或认证方式与项目仓库不匹配。");
    const accepted = await this.store.transaction(async () => {
      const current = await this.authorize(id, actor, "code.operate");
      const space = await this.store.allocateSpace(id, actor.id);
      if (space.status === "ready") {
        if (space.gitAccountId !== account.id) throw accountError("已准备的空间不能切换 Git 账号，请轮换原账号凭据。", 409);
        return { space, start: false };
      }
      if (space.requestId === value.requestId) {
        if (space.gitAccountId !== account.id) throw accountError("相同操作标识不能绑定不同 Git 账号。", 409);
        return { space, start: false };
      }
      if (space.status === "preparing") throw accountError("开发空间正在准备，请稍候。", 409);
      const latest = await this.gitAccounts.read(account.id, actor.id);
      if (latest.revision !== account.revision || current.project.revision !== context.project.revision) throw accountError("项目或凭据已变更，请重试。", 409);
      return { space: await this.store.updateSpace(space.id, space.revision, { status: "preparing", gitAccountId: account.id, requestId: value.requestId, error: null, workerPid: process.pid }), start: true };
    });
    if (accepted.start) {
      const operation = { controller: new AbortController(), projectId: id, userId: actor.id };
      this.active.set(accepted.space.id, operation);
      operation.promise = this.prepareOperation(accepted.space, context, account, operation.controller.signal)
        .catch(error => { operation.error = presentError(error); })
        .finally(() => this.active.delete(accepted.space.id));
    }
    return { space: presentSpace(accepted.space) };
  }
  async prepareOperation(space, context, account, signal) {
    const actor = { id: space.userId };
    const authorize = async () => {
      if (signal.aborted || this.closed) throw accountError("开发空间准备已停止。", 409);
      const current = await this.authorize(space.projectId, actor, "code.operate");
      const latest = await this.gitAccounts.read(account.id, actor.id);
      if (current.project.revision !== context.project.revision || current.project.repository.revision !== context.project.repository.revision || latest.revision !== account.revision)
        throw accountError("项目或 Git 凭据在准备期间已变更，请检查后重试。", 409);
      return current;
    };
    try {
      await authorize();
      await this.checkConnection(account, context.project.repository.remoteUrl, { signal });
      await authorize();
      const { memberStorageRoot } = await readSystemSettings(this.store.database.dataRoot);
      // The persisted preparation revision gives each accepted attempt its own
      // short path while failed checkouts remain available for inspection.
      const target = path.join(memberStorageRoot, "projects", space.projectId, "members", space.userId, `repository-${space.revision}`);
      await this.clone({ account, remote: context.project.repository.remoteUrl, target, memberStorageRoot, signal, preserveOnFailure: true,
        publish: () => this.store.transaction(async () => {
          const latest = await authorize();
          const saved = await this.store.space(space.projectId, space.userId);
          if (saved.status !== "preparing" || saved.requestId !== space.requestId || saved.revision !== space.revision) throw accountError("空间准备请求已失效。", 409);
          const workspaceId = saved.workspaceId || randomUUID();
          await this.store.writeWorkspace(workspaceId, this.workspaceConfig(workspaceId, latest.project, space, account, target));
          await this.store.updateSpace(saved.id, saved.revision, { workspaceId, status: "ready", error: null, workerPid: null });
          await this.store.audit(actor, "project.space.ready", { projectId: space.projectId, spaceId: space.id });
          return workspaceId;
        }) });
    } catch (error) {
      const saved = await this.store.space(space.projectId, space.userId);
      if (saved?.status === "preparing" && saved.requestId === space.requestId)
        await this.store.updateSpace(saved.id, saved.revision, { status: "failed", error: presentError(error).message, workerPid: null });
    }
  }
  workspaceConfig(workspaceId, project, space, account, target, previous = {}) {
    return { ...defaultChannelConfig(), ...previous, version: 5,
      workspace: { ...previous.workspace, id: workspaceId, name: `project-${project.id}`, owner_user_id: space.userId, project_id: project.id },
      execution: { ...previous.execution, repository: target, projectName: project.id, gitAccountId: account.id, remoteUrl: project.repository?.remoteUrl || previous.execution?.remoteUrl,
        baseRef: project.settings.baseRef || "HEAD", initCommands: project.settings.initCommands || [] },
      agent: previous.agent || { provider: "codex", model: "", reasoningEffort: "", permissionMode: "ask", options: {} },
      ...(project.settings.tapd ? { tapd: project.settings.tapd } : {}),
      prompt_templates: project.settings.prompts || {} };
  }
  async syncSpaces(project) {
    for (const space of await this.store.projectSpaces(project.id)) {
      if (!space.workspaceId) continue;
      const previous = await this.store.readWorkspace(space.workspaceId, space.userId);
      await this.store.writeWorkspace(space.workspaceId, this.workspaceConfig(space.workspaceId, project, space, { id: space.gitAccountId }, previous.execution.repository, previous));
    }
  }
  async enforce() {
    for (const operation of this.active.values()) {
      try { await this.authorize(operation.projectId, { id: operation.userId }, "code.operate"); }
      catch { operation.controller.abort(); this.onRevoke({ userId: operation.userId }); }
    }
    for (const [workspaceId, context] of this.workspaces?.contexts || []) {
      const space = await this.store.workspaceSpace(workspaceId);
      if (!space) continue;
      try { await this.authorize(space.projectId, { id: space.userId }, "session.view"); }
      catch {
        this.onRevoke({ userId: space.userId });
        await context.sessions.revokeAccess?.();
        continue;
      }
      for (const runtime of context.sessions.sessions?.values() || []) {
        if (!runtime.pipelineActive && !runtime.turnId) continue;
        try { await this.authorize(space.projectId, { id: space.userId }, runtime.executionPermission || "session.start"); }
        catch { await context.sessions.revokeAccess?.(runtime.key); }
      }
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const operation of this.active.values()) operation.controller.abort();
    await Promise.allSettled([...this.active.values()].map(operation => operation.promise));
    await this.enforcing;
  }
}
module.exports = { ProjectServices };
