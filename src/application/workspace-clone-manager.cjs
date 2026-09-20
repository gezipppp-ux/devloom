const { WorkspaceCloneStore } = require("../storage/workspace-clone-store.cjs");
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
    this.store.recover();
  }
  assertStorage() {
    if (this.storageFailure) throw new Error("克隆任务存储异常，请检查磁盘与数据库并重启服务；不会自动重复克隆。");
  }
  list(actor) { this.assertStorage(); this.store.recover(); return this.store.list(actor.id).map(presentWorkspaceClone); }
  read(id, actor) { this.assertStorage(); this.store.recover(); return presentWorkspaceClone(this.store.read(id, actor.id)); }
  dismiss(id, actor) { this.store.dismiss(id, actor.id); }
  start(input, actor) {
    this.assertStorage();
    if (this.closing) throw new Error("服务正在关闭，请稍后再试。");
    const validated = validateCloneInput(input);
    const { row, created } = this.store.create(actor.id, validated);
    if (created) {
      const controller = new AbortController();
      const operation = { controller };
      this.active.set(row.id, operation);
      operation.promise = Promise.resolve().then(() => this.run(row, actor, controller.signal))
        .catch(error => { this.storageFailure = error; })
        .finally(() => this.active.delete(row.id));
    }
    return presentWorkspaceClone(row);
  }
  async run(row, actor, signal) {
    let lastProgress = "";
    try {
      const authorize = () => {
        if (signal.aborted) throw new Error("服务关闭，克隆已中断。");
        const current = this.accounts.byId(actor.id);
        if (!current || current.status !== "active") throw new Error("账号已停用，无法完成工作区创建。");
      };
      authorize();
      await this.workspaces.createFromGit(JSON.parse(row.input_json), actor, authorize, {
        signal,
        onProgress: progress => {
          const encoded = JSON.stringify(progress);
          if (encoded !== lastProgress) { this.store.progress(row.id, progress); lastProgress = encoded; }
        },
        // The workspace and completed job are published in one SQLite transaction.
        publish: create => this.database.transaction(() => {
          const workspace = create();
          this.store.finish(row.id, "completed", workspace);
          this.accounts.audit(actor, "workspace.clone.completed", workspace.id, { cloneId: row.id });
          return workspace;
        }),
      });
    } catch (error) {
      this.store.finish(row.id, signal.aborted ? "interrupted" : "failed", null,
        signal.aborted ? "服务已停止，克隆已中断。请重新创建工作区。" : error.message);
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
