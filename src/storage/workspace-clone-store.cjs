const { isDeepStrictEqual } = require("node:util");
const { accountError } = require("../domain/account.cjs");

function cloneRecord(row) {
  return { id: row.id, owner_user_id: row.ownerUserId, request_id: row.requestId,
    input_json: JSON.stringify(row.input), status: row.status, progress_json: JSON.stringify(row.progress),
    workspace_json: row.workspace == null ? null : JSON.stringify(row.workspace), error: row.error,
    worker_pid: row.workerPid, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
    dismissed_at: row.dismissedAt?.toISOString() || null };
}

class WorkspaceCloneStore {
  constructor(database) { this.database = database; }

  async read(id, ownerUserId) {
    const row = await this.database.client.workspaceClone.findFirst({ where: { id, ownerUserId } });
    if (!row) throw accountError("克隆任务不存在。", 404);
    return cloneRecord(row);
  }

  async list(ownerUserId) {
    return (await this.database.client.workspaceClone.findMany({ where: { ownerUserId, dismissedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }] })).map(cloneRecord);
  }

  async create(ownerUserId, input) {
    try {
      return await this.database.transaction(async () => {
        const { requestId, ...draft } = input;
        const data = JSON.parse(JSON.stringify(draft));
        const existing = await this.database.client.workspaceClone.findUnique({ where: { ownerUserId_requestId: { ownerUserId, requestId } } });
        if (existing) {
          if (!isDeepStrictEqual(existing.input, data)) throw accountError("该请求已提交，请刷新后创建新的克隆任务。", 409);
          return { row: cloneRecord(existing), created: false };
        }
        const active = await this.database.client.workspaceClone.findMany({ where: { ownerUserId, status: "running" } });
        if (active.some((row) => row.input.name === draft.name || row.input.remoteUrl === draft.remoteUrl))
          throw accountError("该项目正在克隆，请查看已有任务进度。", 409);
        if (active.length >= 3) throw accountError("最多同时克隆 3 个项目，请等待当前任务完成。", 409);
        const row = await this.database.client.workspaceClone.create({ data: { ownerUserId, requestId, input: data,
          status: "running", progress: { stage: "preparing", percent: null }, workerPid: process.pid } });
        return { row: cloneRecord(row), created: true };
      });
    } catch (error) {
      if (["P2002", "P2034"].includes(error.code)) throw accountError("克隆记录已变更，请使用同一请求重试。", 409);
      throw error;
    }
  }

  async progress(id, progress) {
    await this.database.client.workspaceClone.updateMany({ where: { id, status: "running" }, data: { progress } });
  }

  async finish(id, status, workspace = null, error = null) {
    await this.database.client.workspaceClone.updateMany({ where: { id, status: "running" },
      data: { status, workspace: workspace || this.database.jsonNull, error } });
  }

  async dismiss(id, ownerUserId) {
    const row = await this.read(id, ownerUserId);
    if (row.status === "running") throw accountError("克隆尚未结束，不能移除进度记录。", 409);
    await this.database.client.workspaceClone.update({ where: { id }, data: { dismissedAt: new Date() } });
  }

  async recover() {
    // Execution still belongs to one server host; PostgreSQL alone does not
    // authorize another host to take over recorded worktrees or processes.
    for (const row of await this.database.client.workspaceClone.findMany({ where: { status: "running" }, select: { id: true, workerPid: true } })) {
      try { process.kill(row.workerPid, 0); }
      catch (error) {
        if (error.code === "ESRCH") await this.finish(row.id, "interrupted", null,
          "服务进程已退出，克隆已中断。不会自动重试；若项目目录残留，请管理员检查后再创建。");
      }
    }
  }
}

module.exports = { WorkspaceCloneStore };
