const { workflowActorAllowed } = require("./workflow-handoffs.cjs");
const { workflowHandler } = require("./workflow-actions.cjs");

function deliveryReviewer(issue, edge) {
  const next = issue.workflowVersion.definition.nodes.find(node => node.id === edge.to);
  return edge.assignment === "executor" ? issue.developerId : workflowHandler(issue, next);
}

function deliverySubmission(issue, actorId, permissions) {
  const edges = issue.workflowVersion.definition.transitions.filter(edge => edge.from === issue.status && edge.trigger === "delivery.submitted");
  const edge = edges.length === 1 ? edges[0] : null;
  const task = issue.developmentClaim?.task;
  const allowed = issue.release?.status !== "archived" && Boolean(edge) && ["issue.view", "deliverable.create", edge?.permission].every(permission => permissions.includes(permission))
    && workflowActorAllowed(issue, edge, actorId, permissions)
    && (!task || permissions.includes("session.view") && task.executorId === actorId && ["planned", "started", "completed"].includes(task.status));
  const previous = issue.deliverables?.[0];
  return { allowed, taskId: task?.id || null, label: edge?.name || "", transitionId: edge?.id || null, reviewerId: edge ? deliveryReviewer(issue, edge) : null,
    previous: previous?.status === "returned" ? { id: previous.id, revision: previous.revision } : null };
}

module.exports = { deliverySubmission, deliveryReviewer };
