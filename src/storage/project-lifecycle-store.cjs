const { accountError } = require("../domain/account.cjs");
const { issueCompleted, issueWorkflowNode } = require("../domain/issue-workflows.cjs");

function conflict() { return accountError("资料已修改，请刷新后重试。", 409); }
class ProjectLifecycleStore {
  constructor(database) { this.database = database; }
  async transaction(operation) {
    try { return await this.database.transaction(operation); }
    catch (error) { if (["P2034", "P2002"].includes(error.code)) throw conflict(); throw error; }
  }
  async releases(projectId, archived) {
    const rows = await this.database.client.projectRelease.findMany({ where: { projectId, ...(archived ? {} : { status: "active" }) }, orderBy: { createdAt: "desc" } });
    return this.withProgress(projectId, rows);
  }
  async withProgress(projectId, rows) {
    if (!rows.length) return [];
    const groups = await this.database.client.projectIssue.groupBy({ by: ["releaseId", "workflowVersionId", "status"], where: { projectId, releaseId: { in: rows.map(row => row.id) } }, _count: { _all: true } });
    const versions = await this.database.client.systemWorkflowVersion.findMany({ where: { id: { in: [...new Set(groups.map(group => group.workflowVersionId))] } }, select: { id: true, definition: true } });
    const workflows = new Map(versions.map(version => [version.id, version]));
    const summaries = new Map(rows.map(row => [row.id, { total: 0, completed: 0, cancelled: 0 }]));
    for (const group of groups) {
      const summary = summaries.get(group.releaseId);
      const count = group._count._all;
      summary.total += count;
      const kind = issueWorkflowNode({ status: group.status, workflowVersion: workflows.get(group.workflowVersionId) })?.kind;
      if (kind === "completed") summary.completed += count;
      if (kind === "cancelled") summary.cancelled += count;
    }
    return rows.map(row => ({ ...row, progress: summaries.get(row.id) }));
  }
  async release(projectId, id) {
    const row = await this.database.client.projectRelease.findFirst({ where: { projectId, id } });
    if (!row) throw accountError("发布版本不存在。", 404);
    return row;
  }
  async writableRelease(projectId, id) {
    if (!id) return;
    const row = await this.release(projectId, id);
    if (row.status === "archived") throw accountError("发布版本已归档，请先恢复。", 409);
  }
  async saveRelease(projectId, id, revision, data) {
    if (!id) return this.database.client.projectRelease.create({ data: { projectId, ...data } });
    await this.writableRelease(projectId, id);
    return this.changeRelease(projectId, id, revision, data);
  }
  async changeRelease(projectId, id, revision, data) {
    const result = await this.database.client.projectRelease.updateMany({ where: { id, projectId, revision }, data: { ...data, revision: { increment: 1 } } });
    if (!result.count) throw conflict();
    return this.release(projectId, id);
  }
  async archiveRelease(projectId, id, revision, archive) {
    await this.release(projectId, id);
    if (archive) {
      if (await this.database.client.projectDeliverable.count({ where: { projectId, status: { in: ["pending", "returned"] }, next: { is: null }, issue: { releaseId: id } } })) throw accountError("版本仍有待验证或退回的交付，请先完成验收。", 409);
      const issues = await this.database.client.projectIssue.findMany({ where: { projectId, releaseId: id }, include: { workflowVersion: true } });
      if (issues.some(issue => !issueCompleted(issue))) throw accountError("版本仍有未完成或未取消事项。", 409);
      if (await this.database.client.developmentTask.count({ where: { projectId, releaseId: id, status: { notIn: ["completed", "cancelled", "merged"] } } })) throw accountError("版本仍有未结束开发任务。", 409);
    }
    return this.changeRelease(projectId, id, revision, { status: archive ? "archived" : "active" });
  }
}
module.exports = { ProjectLifecycleStore };
