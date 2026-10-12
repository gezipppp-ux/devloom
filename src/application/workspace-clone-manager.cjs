const { WorkspaceCloneStore } = require("../storage/workspace-clone-store.cjs");
const { presentError } = require("./error-presenter.cjs");
const { AccountStore } = require("../storage/account-store.cjs");
const { validateCloneInput } = require("../domain/workspace-clone.cjs");
const { presentWorkspaceClone } = require("./workspace-clone-presenter.cjs");

class WorkspaceCloneManager {
  constructor(database, workspaces) {
    this.store = new WorkspaceCloneStore(database);
    this.accounts = new AccountStore(database);
    this.database = database;
    this.workspaces = workspaces;
    this.active = new Map();
    this.closing = false;
    this.storageFailure = null;
  }
  assertStorage() {
    if (this.storageFailure) throw new Error("克隆任务存储异常，请检查磁盘与数据库并重启服务；不会自动重复克隆。");
  }
  async list(actor) { this.assertStorage(); (await this.store.recover()); return (await this.store.list(actor.id)).map(presentWorkspaceClone); }
  async read(id, actor) { this.assertStorage(); (await this.store.recover()); return presentWorkspaceClone((await this.store.read(id, actor.id))); }
  async dismiss(id, actor) { (await this.store.dismiss(id, actor.id)); }
  async start(input, actor) {
    this.assertStorage();
    if (this.closing) throw new Error("服务正在关闭，请稍后再试。");
    const validated = validateCloneInput(input);
    const { row, created } = (await this.store.create(actor.id, validated));
    if (created) {
      const controller = new AbortController();
      const operation = { controller };
      this.active.set(row.id, operation);
      operation.promise = Promise.resolve().then(async () => (await this.run(row, actor, controller.signal)))
        .catch(error => { this.storageFailure = error; })
        .finally(() => this.active.delete(row.id));
    }
    return presentWorkspaceClone(row);
  }
  async run(row, actor, signal) {
    let lastProgress = "";
    let progressWrites = Promise.resolve();
    let progressError;
    try {
      const authorize = async () => {
        if (signal.aborted) throw new Error("服务关闭，克隆已中断。");
        const current = (await this.accounts.byId(actor.id));
        if (!current || current.status !== "active") throw new Error("账号已停用，无法完成工作区创建。");
      };
      (await authorize());
      await this.workspaces.createFromGit(JSON.parse(row.input_json), actor, authorize, {
        signal,
        onProgress: progress => {
          const encoded = JSON.stringify(progress);
          if (encoded === lastProgress) return;
          lastProgress = encoded;
          const snapshot = structuredClone(progress);
          progressWrites = progressWrites.then(async () => (await this.store.progress(row.id, snapshot)))
            .catch(error => { progressError ||= error; });
          return progressWrites.then(() => { if (progressError) throw progressError; });
        },
        // Publish the workspace and completed job in one short transaction.
        publish: async create => {
          await progressWrites;
          if (progressError) throw progressError;
          return this.database.transaction(async () => {
            await authorize();
            const workspace = await create();
            (await this.store.finish(row.id, "completed", workspace));
            (await this.accounts.audit(actor, "workspace.clone.completed", workspace.id, { cloneId: row.id }));
            return workspace;
          });
        },
      });
    } catch (error) {
      await progressWrites;
      (await this.store.finish(row.id, signal.aborted ? "interrupted" : "failed", null,
        signal.aborted ? "服务已停止，克隆已中断。请重新创建工作区。" : presentError(error).message));
    }
  }
  async close() {
    this.closing = true;
    for (const { controller } of this.active.values()) controller.abort();
    await Promise.all([...this.active.values()].map(operation => operation.promise));
    this.assertStorage();
  }
}
module.exports = { WorkspaceCloneManager };
