const { accountError } = require("../domain/account.cjs");
const { issueCompleted } = require("../domain/issue-workflows.cjs");

function conflict() { return accountError("资料已修改，请刷新后重试。", 409); }
class ProjectLifecycleStore {
  constructor(database) { this.database = database; }
  async transaction(operation) {
    try { return await this.database.transaction(operation); }
    catch (error) { if (["P2034", "P2002"].includes(error.code)) throw conflict(); throw error; }
  }
  async releases(projectId, archived) {
    return this.database.client.projectRelease.findMany({ where: { projectId, ...(archived ? {} : { status: "active" }) }, orderBy: { createdAt: "desc" } });
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
      const issues = await this.database.client.projectIssue.findMany({ where: { projectId, releaseId: id }, include: { workflowVersion: true } });
      if (issues.some(issue => !issueCompleted(issue))) throw accountError("版本仍有未完成或未取消事项。", 409);
      if (await this.database.client.developmentTask.count({ where: { projectId, releaseId: id, status: { notIn: ["completed", "cancelled", "merged"] } } })) throw accountError("版本仍有未结束开发任务。", 409);
    }
    return this.changeRelease(projectId, id, revision, { status: archive ? "archived" : "active" });
  }
}
module.exports = { ProjectLifecycleStore };
