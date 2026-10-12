const { accountError } = require("../domain/account.cjs");

function conflict() { return accountError("流程已修改，请刷新后重试。", 409); }
class SystemWorkflowStore {
  constructor(database) { this.database = database; }
  async transaction(operation) {
    try { return await this.database.transaction(operation); }
    catch (error) { if (["P2034", "P2002"].includes(error.code)) throw conflict(); throw error; }
  }
  async workflow(type) {
    const row = await this.database.client.systemWorkflow.findUnique({ where: { type }, include: { versions: { orderBy: { version: "desc" } } } });
    if (!row) throw accountError("系统流程尚未初始化，请检查数据库迁移。", 503);
    return row;
  }
  async save(type, revision, definition, publish) {
    const current = await this.workflow(type);
    const result = await this.database.client.systemWorkflow.updateMany({ where: { id: current.id, revision }, data: { revision: { increment: 1 }, ...(publish ? { publishedVersion: { increment: 1 } } : { draft: definition }) } });
    if (!result.count) throw conflict();
    if (publish) await this.database.client.systemWorkflowVersion.create({ data: { workflowId: current.id, version: current.publishedVersion + 1, definition } });
    return this.workflow(type);
  }
}
module.exports = { SystemWorkflowStore };
