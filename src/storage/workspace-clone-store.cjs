const { randomUUID } = require("node:crypto");
const { accountError } = require("../domain/account.cjs");

class WorkspaceCloneStore {
  constructor(database) { this.db = database.handle; }
  read(id, owner) {
    const row = this.db.prepare("SELECT * FROM workspace_clones WHERE id=? AND owner_user_id=?").get(id, owner);
    if (!row) throw accountError("克隆任务不存在。", 404);
    return row;
  }
  list(owner) {
    return this.db.prepare("SELECT * FROM workspace_clones WHERE owner_user_id=? AND dismissed_at IS NULL ORDER BY created_at DESC,id").all(owner);
  }
  create(owner, input) {
    return this.db.transaction(() => {
      const { requestId, ...draft } = input;
      const encoded = JSON.stringify(draft);
      const existing = this.db.prepare("SELECT * FROM workspace_clones WHERE owner_user_id=? AND request_id=?").get(owner, requestId);
      if (existing) {
        if (existing.input_json !== encoded) throw accountError("该请求已提交，请刷新后创建新的克隆任务。", 409);
        return { row: existing, created: false };
      }
      const active = this.list(owner).filter(row => row.status === "running");
      if (active.some(row => {
        const other = JSON.parse(row.input_json);
        return other.name === draft.name || other.remoteUrl === draft.remoteUrl;
      })) throw accountError("该项目正在克隆，请查看已有任务进度。", 409);
      if (active.length >= 3) throw accountError("最多同时克隆 3 个项目，请等待当前任务完成。", 409);
      const id = randomUUID(), now = new Date().toISOString();
      this.db.prepare("INSERT INTO workspace_clones(id,owner_user_id,request_id,input_json,status,progress_json,worker_pid,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(id, owner, requestId, encoded, "running", JSON.stringify({ stage: "preparing", percent: null }), process.pid, now, now);
      return { row: this.read(id, owner), created: true };
    }).immediate();
  }
  progress(id, progress) {
    this.db.prepare("UPDATE workspace_clones SET progress_json=?,updated_at=? WHERE id=? AND status='running'")
      .run(JSON.stringify(progress), new Date().toISOString(), id);
  }
  finish(id, status, workspace = null, error = null) {
    this.db.prepare("UPDATE workspace_clones SET status=?,workspace_json=?,error=?,updated_at=? WHERE id=? AND status='running'")
      .run(status, workspace ? JSON.stringify(workspace) : null, error, new Date().toISOString(), id);
  }
  dismiss(id, owner) {
    const row = this.read(id, owner);
    if (row.status === "running") throw accountError("克隆尚未结束，不能移除进度记录。", 409);
    this.db.prepare("UPDATE workspace_clones SET dismissed_at=? WHERE id=?").run(new Date().toISOString(), id);
  }
  recover() {
    for (const row of this.db.prepare("SELECT id,worker_pid FROM workspace_clones WHERE status='running'").all()) {
      try { process.kill(row.worker_pid, 0); }
      catch (error) {
        if (error.code === "ESRCH") this.finish(row.id, "interrupted", null,
          "服务进程已退出，克隆已中断。不会自动重试；若项目目录残留，请管理员检查后再创建。");
      }
    }
  }
}
module.exports = { WorkspaceCloneStore };
