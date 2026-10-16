const { workflowActorAllowed } = require("./workflow-handoffs.cjs");

function deliverySubmission(issue, actorId, permissions) {
  const edges = issue.workflowVersion.definition.transitions.filter(edge => edge.from === issue.status && edge.trigger === "delivery.submitted");
  const edge = edges.length === 1 ? edges[0] : null;
  const task = issue.developmentClaim?.task;
  const allowed = issue.release?.status !== "archived" && Boolean(edge) && ["issue.view", "deliverable.create", edge?.permission].every(permission => permissions.includes(permission))
    && workflowActorAllowed(issue, edge, actorId, permissions)
    && (!task || permissions.includes("session.view") && task.executorId === actorId && ["planned", "started", "completed"].includes(task.status));
  return { allowed, taskId: task?.id || null, label: task?.status === "planned" ? "提交已有成果" : task ? "提交交付并送验" : "提交人工成果" };
}

module.exports = { deliverySubmission };
