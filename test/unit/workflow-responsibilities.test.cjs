const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultWorkflow } = require("../../src/domain/issue-workflows.cjs");
const { responsibilityPermissions } = require("../../src/domain/workflow-actions.cjs");

test("responsibility permissions follow the configured verification nodes and their actions", () => {
  const workflow = defaultWorkflow("bug");
  const original = responsibilityPermissions(workflow);
  assert.ok(original.qaOwnerId.includes("deliverable.review"));
  assert.ok(original.qaOwnerId.includes("issue.accept"));
  assert.ok(original.acceptanceOwnerId.includes("issue.accept"));
  const node = workflow.nodes.find(item => item.id === "resolved");
  node.handler = "acceptanceOwner";
  for (const edge of workflow.transitions.filter(item => item.from === node.id)) edge.permission = "issue.transition";
  const changed = responsibilityPermissions(workflow);
  assert.ok(changed.acceptanceOwnerId.includes("deliverable.review"));
  assert.ok(changed.acceptanceOwnerId.includes("issue.transition"));
  assert.ok(!changed.qaOwnerId.includes("deliverable.review"));
});
