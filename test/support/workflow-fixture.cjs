const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { workflowDefinition } = require("../../src/domain/issue-workflows.cjs");
const { SystemWorkflowStore } = require("../../src/storage/system-workflow-store.cjs");

// A configurable, non-code deliverable workflow for collaboration-only tests.
function reviewWorkflow() {
  const node = (id, kind, handler = "businessOwner") => ({ id, name: id, kind, handler, category: id === "review" || id === "checking" ? "verification" : "work", allowDevelopment: false, active: id === "checking" });
  const edge = (from, to, trigger, actor, assignment = "role") => ({ id: from + "_" + to, from, to, name: trigger, trigger, actor, assignment, permission: trigger.startsWith("verification") ? "issue.accept" : "issue.transition", requiresReason: trigger === "verification.returned" });
  return { nodes: [node("draft", "initial"), node("review", "normal", "qaOwner"), node("checking", "normal", "qaOwner"), node("done", "completed")], transitions: [
    edge("draft", "review", "delivery.submitted", "handler", "reviewer"),
    edge("review", "checking", "verification.started", "reviewer", "reviewer"),
    ...["review", "checking"].flatMap(from => [edge(from, "done", "verification.accepted", "reviewer"), edge(from, "draft", "verification.returned", "reviewer")]),
    { ...edge("done", "draft", "manual", "assigner"), requiresReason: true },
  ] };
}
async function installReviewWorkflow(database, definition = reviewWorkflow(), type = "requirement") {
  const store = new SystemWorkflowStore(database);
  const current = await store.workflow(type);
  await store.transaction(() => store.save(type, current.revision, workflowDefinition(definition, { publish: true }), true));
}
async function recordDevelopmentTurn(database, development, projectId, taskId, actor, turnId = randomUUID()) {
  let task = await development.store.task(projectId, taskId);
  const workspace = task.workspaceId ? { id: task.workspaceId } : await database.client.workspace.create({ data: { ownerUserId: actor.id, name: "Fake execution" } });
  await database.client.developmentTask.update({ where: { id: taskId }, data: { status: "started", workspaceId: workspace.id, runKey: task.runKey || task.id } });
  task = await development.store.task(projectId, taskId);
  await development.store.transaction(() => development.workflowExecution.prepare(task, actor));
  const root = path.join(database.dataRoot, "workspaces", workspace.id, "runs", task.runKey);
  await database.writeDocument(path.join(root, "run.json"), { execution: { status: "completed" } });
  await database.appendLog(path.join(root, "agent-events.jsonl"), JSON.stringify({ type: "turn-started", turn: { id: turnId } }) + "\n");
  await development.workflowExecution.event(workspace.id, task.runKey);
  return development.store.task(projectId, taskId);
}
module.exports = { reviewWorkflow, installReviewWorkflow, recordDevelopmentTurn };
