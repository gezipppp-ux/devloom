const { validateModelSelection } = require("../codex/models.cjs");
const { assertPermissionAvailable } = require("../codex/permissions.cjs");
const { validatePermissionMode } = require("../domain/permissions.cjs");

function selectionFromCodex(codex = {}) {
  return {
    model: typeof codex.model === "string" ? codex.model : "",
    reasoningEffort:
      typeof codex.reasoning_effort === "string" ? codex.reasoning_effort : "",
    permissionMode: validatePermissionMode(codex.permission_mode),
  };
}

function sameSettings(left, right) {
  return ["model", "reasoningEffort", "permissionMode"].every(
    (field) => left[field] === right[field],
  );
}

// Desired settings live outside run.json, whose initial pipeline owns its snapshot.
class SessionSettings {
  constructor({ store, client, sessions, worktreeReason, emit, assertOpen }) {
    this.store = store;
    this.client = client;
    this.sessions = sessions;
    this.worktreeReason = worktreeReason;
    this.emit = emit;
    this.assertOpen = assertOpen;
  }

  read(key, state = this.store.read(key)) {
    const saved = this.store.readExecutionSettings(key);
    const initial = selectionFromCodex(state.codex);
    return {
      selection: saved.selection || initial,
      active: saved.active || initial,
    };
  }

  describe(key, state = this.store.read(key)) {
    const { selection, active } = this.read(key, state);
    const runtime = this.sessions.get(key);
    const running = Boolean(runtime?.turnId || runtime?.requests.size);
    const applied = runtime?.activeExecutionSettings || active;
    return {
      executionSettings: selection,
      activeExecutionSettings: running ? applied : null,
      settingsPending: running && !sameSettings(selection, applied),
    };
  }

  publish(key) {
    const settings = this.describe(key);
    this.emit({
      key,
      type: "execution-settings",
      ...settings,
      at: new Date().toISOString(),
    });
    return settings;
  }

  initialize(key, codex) {
    const selection = selectionFromCodex(codex);
    this.store.writeExecutionSettings(key, { selection, active: selection });
  }

  starting(key, selection) {
    this.sessions.get(key).activeExecutionSettings = selection;
  }

  applied(key, selection) {
    try {
      const current = this.read(key);
      this.store.writeExecutionSettings(key, { ...current, active: selection });
      this.publish(key);
    } catch (error) {
      // Native execution has already started. A local snapshot failure must not
      // disconnect that live turn or prevent the user from interrupting it.
      this.emit({
        key,
        type: "error",
        error: `本轮设置已应用，但保存执行设置快照失败：${error.message}`,
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
    const state = this.store.read(key);
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
    const current = this.read(key, state);
    const requested = { ...current.selection, ...input };
    const permissionMode = validatePermissionMode(requested.permissionMode);
    const model = await validateModelSelection(this.client, requested);
    this.assertOpen();
    await assertPermissionAvailable(this.client, permissionMode);
    this.assertOpen();
    const selection = {
      model: model.model,
      reasoningEffort: model.reasoning_effort,
      permissionMode,
    };
    this.store.writeExecutionSettings(key, { ...this.read(key), selection });
    const settings = this.publish(key);
    return {
      executionSettings: settings.executionSettings,
      pending: settings.settingsPending,
    };
  }
}

module.exports = { SessionSettings };
