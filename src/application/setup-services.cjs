const { SetupStore } = require("../storage/setup-store.cjs");
const { accountError } = require("../domain/account.cjs");
const { required, setupAdminInput, setupStepInput, assertSetupStep, environmentReadiness, setupDraftInput } = require("../domain/setup-state.cjs");
const { productTemplate, developerTemplate } = require("../domain/project-permissions.cjs");
const { readSystemSettings, prepareSystemSettings, savePreparedSystemSettings } = require("../config/system-settings.cjs");
const { presentSetup, presentSetupStatus } = require("./setup-presenter.cjs");

class SetupServices {
  constructor(database, { accounts, projects, environment, directory = database.dataRoot } = {}) {
    this.store = new SetupStore(database);
    Object.assign(this, { accounts, projects, environment, directory });
  }
  async issueToken() { return this.store.issueToken(); }
  async status(actor) { return presentSetupStatus(await this.store.read(), actor); }
  async gate(actor, method, pathname) {
    if (!required(await this.store.read())) return;
    const setupRoute = /^\/api\/system\/setup(?:\/(?:environment|directory|departments|accounts|project|complete|draft))?$/.test(pathname);
    const environmentRoute = /^\/api\/system\/environment(?:\/(?:check|update|install))?$/.test(pathname);
    if (actor?.role === "admin" && (setupRoute || environmentRoute || method === "GET" && ["/api/system/settings", "/api/system/directories"].includes(pathname))) return;
    throw accountError("请先由管理员完成系统初始化。", 409, "SETUP_REQUIRED");
  }
  async bootstrap(input) {
    const value = setupAdminInput(input);
    await this.store.verifyToken(await this.store.read(), value.setupToken);
    const prepared = await this.accounts.prepareCreation({ username: value.username, displayName: value.displayName, password: value.password }, true);
    return this.store.transaction(async () => {
      await this.store.verifyToken(await this.store.read(), value.setupToken);
      const user = await this.accounts.createPrepared(prepared, null, true);
      await this.accounts.audit(user, "setup.admin.created", null, { targetUserId: user.id });
      return user;
    });
  }
  async read(actor) {
    await this.accounts.requireAdmin(actor);
    const row = await this.store.read();
    const resources = await this.store.resources(row);
    const settings = await readSystemSettings(this.directory);
    await this.accounts.requireAdmin(actor);
    return presentSetup(row, resources, settings);
  }
  async saveDraft(actor, input, authorize) {
    const value = setupDraftInput(input);
    await authorize?.();
    await this.store.transaction(async () => {
      await this.accounts.requireAdmin(actor);
      const row = await this.store.read();
      if (row.status !== "pending" || row.revision !== value.revision) throw accountError("初始化进度已变更，请重新加载。", 409, "REVISION_CONFLICT");
      await this.store.update(row.revision, { drafts: value.drafts });
    });
    return this.read(actor);
  }
  async submit(actor, step, input, authorize) {
    await this.accounts.requireAdmin(actor);
    const value = setupStepInput(step, input), fingerprint = this.store.fingerprint(step, value);
    if (await this.store.reused(value.requestId, step, fingerprint)) return this.read(actor);
    const initial = await this.store.read();
    assertSetupStep(initial, step, value.revision);
    // All expensive/host operations happen before the short database transaction.
    let prepared;
    if (step === "directory") prepared = prepareSystemSettings(value.value);
    if (step === "accounts" && !value.skip) {
      prepared = await Promise.all(value.value.accounts.map(async account => ({ kind: account.kind,
        record: await this.accounts.prepareCreation({ username: account.username, displayName: account.displayName, password: account.password,
          departmentId: initial.steps.departments.data[account.kind], role: "member", canCreateProjects: false }),
      })));
    }
    if (step === "environment" || step === "complete") {
      const defer = step === "environment" ? value.value.deferCodexLogin : initial.steps.environment?.data?.deferCodexLogin;
      if (!environmentReadiness(await this.environment.read(), defer)) throw accountError("运行环境尚未就绪，请重新检测；安装失败或待重启时不能继续。", 409, "SETUP_ENVIRONMENT_REQUIRED");
    }
    if (step === "complete") {
      const settings = await readSystemSettings(this.directory);
      prepareSystemSettings({ memberStorageRoot: settings.memberStorageRoot });
    }
    await authorize?.();
    await this.store.transaction(async () => {
      await this.accounts.requireAdmin(actor);
      if (await this.store.reused(value.requestId, step, fingerprint)) return;
      const row = await this.store.read();
      assertSetupStep(row, step, value.revision);
      let data;
      if (!value.skip) data = await this.applyStep(actor, step, value.value, row, prepared);
      const steps = { ...row.steps, [step]: { status: value.skip ? "skipped" : "completed", ...(data ? { data } : {}) } };
      const drafts = { ...row.drafts }; delete drafts[step];
      await this.store.update(row.revision, { steps, drafts, ...(step === "complete" ? { status: "completed", completedAt: new Date(), completedBy: actor.id, drafts: {} } : {}) });
      await this.store.record(value.requestId, step, fingerprint);
      await this.accounts.audit(actor, `setup.${step}`, null, { skipped: Boolean(value.skip) });
    });
    return this.read(actor);
  }
  async applyStep(actor, step, value, row, prepared) {
    if (step === "environment") return { deferCodexLogin: value.deferCodexLogin };
    if (step === "directory") {
      const saved = await savePreparedSystemSettings(prepared, this.directory);
      return { memberStorageRoot: saved.memberStorageRoot };
    }
    if (step === "departments") {
      const product = (await this.projects.saveDepartment(actor, { name: "产品部门", permissions: productTemplate }, undefined, { enforce: false })).department;
      const developer = (await this.projects.saveDepartment(actor, { name: "研发部门", permissions: developerTemplate }, undefined, { enforce: false })).department;
      return { product: product.id, developer: developer.id };
    }
    if (step === "accounts") {
      const result = [];
      for (const account of prepared) {
        const user = await this.accounts.createPrepared(account.record, actor);
        result.push({ id: user.id, kind: account.kind });
      }
      return result;
    }
    if (step === "project") {
      const { memberIds, ...input } = value;
      const members = row.steps.accounts?.data || [];
      if (memberIds.some(id => !members.some(account => account.id === id))) throw accountError("只能选择本次创建的测试账号。");
      const { project } = await this.projects.create(actor, input);
      for (const userId of memberIds) {
        const account = members.find(item => item.id === userId);
        await this.projects.saveMember(project.id, actor, { userId, permissions: account.kind === "product" ? productTemplate : developerTemplate }, undefined, { enforce: false });
      }
      return { id: project.id, memberIds };
    }
    if (step === "complete") {
      const resources = await this.store.resources(row);
      if (!resources.admin || resources.admin.role !== "admin" || resources.admin.status !== "active" ||
          resources.departments.length !== 2 || resources.departments.some(item => item.status !== "active") ||
          resources.accounts.length !== (row.steps.accounts?.data?.length || 0) ||
          resources.accounts.some(item => item.status !== "active" || item.role !== "member" || item.departmentId !== row.steps.departments.data[row.steps.accounts.data.find(account => account.id === item.id).kind]) ||
          row.steps.project?.status === "completed" && resources.project?.status !== "active")
        throw accountError("已创建的初始化资料发生变化，请检查账号、部门和项目。", 409);
    }
  }
}
module.exports = { SetupServices };
