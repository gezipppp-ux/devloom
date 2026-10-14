const { accountError } = require("../domain/account.cjs");
const { issueWorkflowNode } = require("../domain/issue-workflows.cjs");
const { workflowHandler } = require("../domain/workflow-actions.cjs");

class WorkActionStore {
  constructor(database) { this.database = database; }
  async syncIssue(issue, { initial = false } = {}) {
    const current = initial ? null : await this.database.client.workAction.findFirst({ where: { issueId: issue.id }, orderBy: { sequence: "desc" } });
    const node = issueWorkflowNode(issue);
    if (!node) throw accountError("事项绑定的流程节点不存在。", 409);
    const terminal = ["completed", "cancelled"].includes(node.kind);
    const assigned = workflowHandler(issue, node), handlerId = assigned || issue.businessOwnerId;
    const category = assigned ? node.category : "planning";
    if (current && !terminal && current.nodeId === node.id && current.handlerId === handlerId && current.category === category && ["ready", "active"].includes(current.status)) return current;
    if (current && ["ready", "active"].includes(current.status)) await this.database.client.workAction.update({ where: { id: current.id }, data: { status: current.nodeId === node.id ? "cancelled" : "completed", endedAt: new Date(), revision: { increment: 1 } } });
    if (terminal) return null;
    return this.database.client.workAction.create({ data: { projectId: issue.projectId, issueId: issue.id, workflowVersionId: issue.workflowVersionId, nodeId: node.id, category, handlerId, sequence: (current?.sequence || 0) + 1 } });
  }
  async start(issue, actorId, revision) {
    const action = await this.database.client.workAction.findFirst({ where: { issueId: issue.id, status: { in: ["ready", "active"] } } });
    if (!action || action.handlerId !== actorId) throw accountError("此步骤未分派给你。", 403);
    if (action.status === "active" && action.revision === revision + 1) return action;
    const changed = await this.database.client.workAction.updateMany({ where: { id: action.id, handlerId: actorId, status: "ready", revision }, data: { status: "active", startedAt: new Date(), revision: { increment: 1 } } });
    if (!changed.count) throw accountError("处理步骤已变化，请刷新。", 409);
    await this.database.client.issueHistory.create({ data: { projectId: issue.projectId, issueId: issue.id, actorId, action: "step.started", data: { actionId: action.id, nodeId: action.nodeId } } });
    return this.database.client.workAction.findUnique({ where: { id: action.id } });
  }
}
module.exports = { WorkActionStore };
