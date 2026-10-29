const { accountError } = require("../domain/account.cjs");
const { handlerFields } = require("../domain/workflow-actions.cjs");

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
  async statusUsage(type) {
    const issues = await this.database.client.projectIssue.findMany({ where: { type, deletedAt: null }, select: { status: true, workflowVersion: { select: { definition: true } } } });
    const usage = new Map();
    for (const issue of issues) {
      const node = issue.workflowVersion.definition.nodes.find(item => item.id === issue.status);
      const key = `${issue.status}:${node.kind}`;
      if (!usage.has(key)) usage.set(key, { id: issue.status, name: node.name, kind: node.kind, count: 0 });
      usage.get(key).count++;
    }
    return [...usage.values()];
  }
  async applyPublished(type, version, definition, mapping, actorId) {
    const issues = await this.database.client.projectIssue.findMany({ where: { type, deletedAt: null }, include: { workflowVersion: true, actions: { where: { status: { in: ["ready", "active"] } } }, deliverables: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } });
    for (const issue of issues) {
      const old = issue.workflowVersion.definition.nodes.find(node => node.id === issue.status);
      const target = definition.nodes.find(node => node.id === (mapping[issue.status] || issue.status));
      if (!target || (["completed", "cancelled"].includes(old.kind) !== ["completed", "cancelled"].includes(target.kind)))
        throw accountError(`事项状态「${old.name}」需要选择对应的新状态。`, 409);
      if (issue.deliverables[0]?.status === "pending" && ["verification.accepted", "verification.returned"].some(trigger => !definition.transitions.some(edge => edge.from === target.id && edge.trigger === trigger)))
        throw accountError(`事项状态「${old.name}」有待验证交付，新状态需要配置验证通过和退回流转。`, 409);
    }
    const issueGroups = new Map(), actionGroups = new Map(), history = [];
    for (const issue of issues) {
      const target = definition.nodes.find(node => node.id === (mapping[issue.status] || issue.status));
      const action = issue.actions[0];
      if (!issueGroups.has(target.id)) issueGroups.set(target.id, []);
      issueGroups.get(target.id).push(issue.id);
      if (action) {
        const assigned = action.explicitHandler && target.handler !== "developer" ? action.handlerId : issue[handlerFields[target.handler]];
        const data = { workflowVersionId: version.id, nodeId: target.id, category: assigned ? target.category : "planning", handlerId: assigned || issue.businessOwnerId };
        const key = JSON.stringify(data);
        if (!actionGroups.has(key)) actionGroups.set(key, { data, ids: [] });
        actionGroups.get(key).ids.push(action.id);
      }
      history.push({ projectId: issue.projectId, issueId: issue.id, actorId, action: "workflow.upgraded", data: { fromVersion: issue.workflowVersion.version, toVersion: version.version, fromStatus: issue.status, toStatus: target.id } });
    }
    for (const [status, ids] of issueGroups) await this.database.client.projectIssue.updateMany({ where: { id: { in: ids } }, data: { workflowVersionId: version.id, status, revision: { increment: 1 } } });
    for (const { data, ids } of actionGroups.values()) await this.database.client.workAction.updateMany({ where: { id: { in: ids } }, data: { ...data, revision: { increment: 1 } } });
    if (history.length) await this.database.client.issueHistory.createMany({ data: history });
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
