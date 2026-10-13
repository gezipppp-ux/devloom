const { agentConfig } = require("../domain/agent-config.cjs");
const { assertAgentIdentity } = require("../domain/agent-contract.cjs");
const { presentError } = require("./error-presenter.cjs");
const { validatePermissionMode } = require("../domain/permissions.cjs");

function selectionFromAgent(config) {
  return { model: config.model, reasoningEffort: config.reasoningEffort,
    permissionMode: validatePermissionMode(config.permissionMode) };
}

function sameSettings(left, right) {
  return ["model", "reasoningEffort", "permissionMode"].every(
    (field) => left[field] === right[field],
  );
}

// Desired settings live outside run.json, whose initial pipeline owns its snapshot.
class SessionSettings {
  constructor({ store, agent, sessions, worktreeReason, emit, assertOpen, authorize = async () => {} }) {
    /** @type {import('../storage/run-store.cjs').RunStore} */
    this.store = store;
    this.agent = agent;
    this.sessions = sessions;
    this.worktreeReason = worktreeReason;
    this.emit = emit;
    this.assertOpen = assertOpen;
    this.authorize = authorize;
  }

  async read(key, state) {
    state ??= await this.store.read(key);
    const saved = (await this.store.readExecutionSettings(key));
    const initial = selectionFromAgent(agentConfig(state));
    return {
      selection: saved.selection || initial,
      active: saved.active || initial,
    };
  }

  async describe(key, state) {
    state ??= await this.store.read(key);
    const { selection, active } = (await this.read(key, state));
    const runtime = this.sessions.get(key);
    const running = Boolean(runtime?.turnId || runtime?.requests.size);
    const applied = runtime?.activeExecutionSettings || active;
    const supplier = await this.agent.describeSupplier?.(key);
    const activeSupplier = runtime?.supplier || (await this.store.readExecutionSettings(key)).supplier || null;
    return {
      ...(supplier ? { activeSupplier, nextSupplier: supplier.nextSupplier,
        supplierPending: Boolean(activeSupplier && (activeSupplier.id !== supplier.nextSupplier.id || activeSupplier.runtimeRevision !== supplier.nextSupplier.runtimeRevision)) } : {}),
      executionSettings: selection,
      activeExecutionSettings: running ? applied : null,
      settingsPending: running && !sameSettings(selection, runtime?.activeRequestedSettings || applied),
    };
  }

  async publish(key) {
    const settings = (await this.describe(key));
    this.emit({
      key,
      type: "execution-settings",
      ...settings,
      at: new Date().toISOString(),
    });
    return settings;
  }

  async initialize(key, config) {
    const selection = selectionFromAgent(config);
    const supplier = this.sessions.get(key)?.supplier;
    (await this.store.writeExecutionSettings(key, { selection, active: selection, ...(supplier ? { initialSupplier: supplier, supplier } : {}) }));
  }

  starting(key, selection, requested = selection) {
    this.sessions.get(key).activeExecutionSettings = selection;
    this.sessions.get(key).activeRequestedSettings = requested;
  }

  async applied(key, selection) {
    try {
      const supplier = this.sessions.get(key)?.supplier;
      (await this.store.updateExecutionSettings(key, current => ({ ...current, active: selection, ...(supplier ? { supplier } : {}) })));
      (await this.publish(key));
    } catch (error) {
      // Native execution has already started. A local snapshot failure must not
      // disconnect that live turn or prevent the user from interrupting it.
      this.emit({
        key,
        type: "error",
        error: `本轮设置已应用，但保存执行设置快照失败：${presentError(error).message}`,
        at: new Date().toISOString(),
      });
    }
  }

  async update(key, input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (field) =>
          !["model", "reasoningEffort", "permissionMode"].includes(field),
      )
    )
      throw new Error("仅允许修改模型、思考强度和权限。");
    const state = await this.store.read(key);
    assertAgentIdentity(this.agent, state);
    const runtime = this.sessions.get(key);
    const reason = this.worktreeReason(state);
    if (reason) throw new Error(reason);
    if (
      !state.session_id ||
      ["preparing", "initializing", "starting"].includes(runtime?.status)
    )
      throw new Error("正在准备会话，请稍候再修改执行设置。");
    if (this.store.isExecutionLocked(key) && !runtime?.initial)
      throw new Error("原 CLI 仍持有任务锁，不能并发修改执行设置。");
    this.store.claim(key);
    const current = (await this.read(key, state));
    const requested = { ...current.selection, ...input };
    const permissionMode = validatePermissionMode(requested.permissionMode);
    const model = await this.agent.validateSelection(requested);
    this.assertOpen();
    await this.agent.assertPermissionAvailable(permissionMode);
    this.assertOpen();
    const selection = {
      model: model.model,
      reasoningEffort: model.reasoningEffort,
      permissionMode,
    };
    await this.authorize();
    (await this.store.updateExecutionSettings(key, saved => ({ ...saved, selection })));
    const settings = (await this.publish(key));
    return {
      executionSettings: settings.executionSettings,
      pending: settings.settingsPending,
    };
  }
}

module.exports = { SessionSettings };
