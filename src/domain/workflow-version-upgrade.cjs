const { accountError } = require("./account.cjs");
const { issueWorkflowNode, assertIssueWritable } = require("./issue-workflows.cjs");
const { currentHandler } = require("./workflow-handoffs.cjs");
const { object, revision, identifier, issueRequestId, text } = require("./project-issues.cjs");

function workflowUpgradeInput(input) {
  object(input, ["requestId", "issueRevision", "actionRevision", "targetVersionId", "tasks", "reason"]);
  const requestId = issueRequestId(input);
  if (!requestId) throw accountError("请提供流程切换请求标识。", 400);
  if (!Array.isArray(input.tasks) || input.tasks.length > 100 || new Set(input.tasks.map(task => task?.id)).size !== input.tasks.length) throw accountError("关联任务快照无效。", 400);
  return { requestId, issueRevision: revision(input.issueRevision), actionRevision: revision(input.actionRevision), targetVersionId: identifier(input.targetVersionId),
    tasks: input.tasks.map(task => { object(task, ["id", "revision"]); return { id: identifier(task.id), revision: revision(task.revision) }; }).sort((a, b) => a.id.localeCompare(b.id)),
    reason: text(input.reason, "切换原因", 4000, { required: true }) };
}
function workflowUpgradePreview(issue, workflow, state) {
  assertIssueWritable(issue);
  const target = workflow.versions.find(version => version.version === workflow.publishedVersion);
  if (!target || target.version <= issue.workflowVersion.version) throw accountError("当前事项已使用最新流程版本。", 409);
  const node = issueWorkflowNode(issue), next = target.definition.nodes.find(candidate => candidate.id === issue.status);
  if (!issue.actions[0] || issue.actions[0].status !== "ready" || !node || !["initial", "normal"].includes(node.kind) || node.active || node.category === "verification") throw accountError("仅尚未开始处理的事项可以切换流程。", 409);
  if (!next || ["kind", "handler", "category", "allowDevelopment", "allowAssignment", "active"].some(field => next[field] !== node[field])) throw accountError("新流程没有可直接映射的同一业务节点，请保留原流程。", 409);
  if (state.deliveries || state.tasks.some(task => task.runKey || task.workspaceId || task.snapshot.startRequest || task.snapshot.workflowIntent || task.workflowEvents.length || !["planned", "cancelled", "merged"].includes(task.status))) throw accountError("已有交付或执行记录的事项不能切换流程。", 409);
  const handlerId = currentHandler(issue);
  if (!handlerId || next.handler === "developer" && handlerId !== issue.developerId) throw accountError("请先修复当前步骤的处理人分派。", 409);
  return { available: true, issueRevision: issue.revision, actionRevision: issue.actions[0].revision, targetVersionId: target.id,
    currentVersion: issue.workflowVersion.version, targetVersion: target.version, statusName: node.name, targetStatusName: next.name, handlerId,
    tasks: state.tasks.map(task => ({ id: task.id, revision: task.revision })).sort((a, b) => a.id.localeCompare(b.id)) };
}

module.exports = { workflowUpgradeInput, workflowUpgradePreview };
