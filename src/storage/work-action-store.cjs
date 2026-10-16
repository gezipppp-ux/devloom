const { accountError } = require("../domain/account.cjs");
const { issueWorkflowNode } = require("../domain/issue-workflows.cjs");
const { workflowHandler } = require("../domain/workflow-actions.cjs");

class WorkActionStore {
  constructor(database) { this.database = database; }
  async syncIssue(issue, { initial = false, handlerId: selectedHandler, explicitHandler = false } = {}) {
    const current = initial ? null : await this.database.client.workAction.findFirst({ where: { issueId: issue.id }, orderBy: { sequence: "desc" } });
    const node = issueWorkflowNode(issue);
    if (!node) throw accountError("事项绑定的流程节点不存在。", 409);
    const terminal = ["completed", "cancelled"].includes(node.kind);
    const assigned = selectedHandler || (node.handler !== "developer" && current?.nodeId === node.id && current.explicitHandler ? current.handlerId : workflowHandler(issue, node));
    const handlerId = assigned || issue.businessOwnerId;
    explicitHandler ||= !selectedHandler && current?.nodeId === node.id && current.explicitHandler;
    const category = assigned ? node.category : "planning";
    if (current && current.workflowVersionId === issue.workflowVersionId && !terminal && current.nodeId === node.id && current.handlerId === handlerId && current.category === category && ["ready", "active"].includes(current.status)) {
      if (current.explicitHandler !== Boolean(explicitHandler)) return this.database.client.workAction.update({ where: { id: current.id }, data: { explicitHandler: Boolean(explicitHandler), revision: { increment: 1 } } });
      return current;
    }
    if (current && ["ready", "active"].includes(current.status)) await this.database.client.workAction.update({ where: { id: current.id }, data: { status: current.nodeId === node.id && current.workflowVersionId === issue.workflowVersionId ? "cancelled" : "completed", endedAt: new Date(), revision: { increment: 1 } } });
    if (terminal) return null;
    return this.database.client.workAction.create({ data: { projectId: issue.projectId, issueId: issue.id, workflowVersionId: issue.workflowVersionId, nodeId: node.id, category, handlerId, explicitHandler: Boolean(explicitHandler), status: node.active ? "active" : "ready", startedAt: node.active ? new Date() : null, sequence: (current?.sequence || 0) + 1 } });
  }
}

module.exports = { WorkActionStore };
