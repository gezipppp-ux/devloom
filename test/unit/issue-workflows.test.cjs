const test = require("node:test");
const assert = require("node:assert/strict");
const { workflowDefinition, defaultWorkflow, issueDevelopmentAllowed, issueCompleted, assertIssueWritable } = require("../../src/domain/issue-workflows.cjs");

test("published workflows validate reachable nodes, immutable identifiers and permission whitelist", () => {
  for (const type of ["requirement", "bug"]) assert.deepEqual(workflowDefinition(defaultWorkflow(type), { publish: true }), defaultWorkflow(type));
  const validate = mutate => { const draft = defaultWorkflow("requirement"); mutate(draft); return () => workflowDefinition(draft, { publish: true }); };
  assert.throws(validate(draft => { draft.nodes[1].kind = "initial"; }), /初始/);
  assert.throws(validate(draft => { draft.nodes.push({ id: "island", name: "孤立", kind: "normal", allowDevelopment: false }); }), /到达/);
  assert.throws(validate(draft => { draft.nodes.forEach(node => { if (["completed", "cancelled"].includes(node.kind)) node.kind = "normal"; }); }), /完成或取消/);
  assert.throws(validate(draft => { draft.transitions[0].permission = "process.exec"; }), /权限/);
  assert.throws(validate(draft => { draft.transitions[0].script = "alert(1)"; }), /权限/);
  assert.throws(validate(draft => { draft.nodes[0].handler = "watchers"; }), /职责/);
  assert.throws(validate(draft => { draft.nodes[0].category = "unknown"; }), /类别/);
  assert.throws(validate(draft => { draft.transitions[0].requiredFields = ["secret"]; }), /字段/);
  assert.throws(validate(draft => { draft.transitions[0].requireAcceptedDelivery = "true"; }), /门禁/);
  assert.throws(validate(draft => { draft.nodes.splice(1, 1); }), /连线/);
  assert.throws(validate(draft => { draft.nodes[1].id = draft.nodes[0].id; }), /标识/);
  assert.throws(validate(draft => { draft.transitions[1].id = draft.transitions[0].id; }), /连线/);
  assert.throws(validate(draft => { draft.nodes.find(node => node.kind === "completed").allowDevelopment = true; }), /不能允许开发/);
  assert.throws(validate(draft => {
    draft.nodes.push({ id: "dead_a", name: "死路甲", kind: "normal", allowDevelopment: false }, { id: "dead_b", name: "死路乙", kind: "normal", allowDevelopment: false });
    for (const [from, to] of [["planned", "dead_a"], ["dead_a", "dead_b"], ["dead_b", "dead_a"]]) draft.transitions.push({ id: `${from}_${to}`, from, to, name: "死路", permission: "issue.transition", requiresReason: false });
  }), /死路/);
  assert.deepEqual(workflowDefinition({ nodes: [], transitions: [] }), { nodes: [], transitions: [] });
});

test("development and completion rules resolve the bound workflow and archive status", () => {
  const issue = { status: "developing", workflowVersion: { definition: defaultWorkflow("requirement") }, release: { status: "active" } };
  assert.equal(issueDevelopmentAllowed(issue), true);
  assert.equal(issueCompleted(issue), false);
  issue.release.status = "archived";
  assert.equal(issueDevelopmentAllowed(issue), false);
  assert.throws(() => assertIssueWritable(issue), /只读/);
  issue.status = "implemented";
  assert.equal(issueCompleted(issue), true);
  issue.release.status = "active";
  issue.workflowVersion.definition.nodes.find(node => node.id === "implemented").allowDevelopment = true;
  assert.equal(issueDevelopmentAllowed(issue), false);
  issue.status = "unknown";
  assert.equal(issueCompleted(issue), false);
  assert.equal(issueDevelopmentAllowed(issue), false);
});
