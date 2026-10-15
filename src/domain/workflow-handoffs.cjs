const { accountError } = require("./account.cjs");
const events = require("../../shared/workflow-events.json");

function workflowEventEdge(issue, trigger) {
  const edges = issue.workflowVersion.definition.transitions.filter(edge => edge.from === issue.status && edge.trigger === trigger);
  if (edges.length !== 1) throw accountError("当前流程未配置唯一的「" + (events[trigger]?.label || trigger) + "」流转，请先核对流程。", 409);
  return edges[0];
}
function currentHandler(issue) {
  return issue.actions?.find(action => ["ready", "active"].includes(action.status))?.handlerId || null;
}
function workflowActorAllowed(issue, edge, actorId, permissions, context = {}) {
  if (edge.actor === "handler") return currentHandler(issue) === actorId;
  if (edge.actor === "developer") return (context.executorId || issue.developerId) === actorId;
  if (edge.actor === "reviewer") return context.reviewerId === actorId && currentHandler(issue) === actorId;
  return edge.actor === "assigner" && (permissions.includes("issue.assign") || edge.trigger === "development.assigned" && context.executorId === actorId && permissions.includes("session.start"));
}
module.exports = { workflowEventEdge, currentHandler, workflowActorAllowed };
