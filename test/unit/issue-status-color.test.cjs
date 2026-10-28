const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultWorkflow } = require("../../src/domain/issue-workflows.cjs");
const { presentWorkbenchPage } = require("../../src/application/workbench-presenter.cjs");

async function color(issue) {
  const { statusHue } = await import("../../web/src/features/projects/status-color.js");
  return statusHue(issue.status, (issue.workflow?.definition?.nodes || []).map(node => node.id));
}

test("default and custom workflow nodes have distinct, stable colours", async () => {
  for (const type of ["requirement", "bug"]) {
    const nodes = defaultWorkflow(type).nodes;
    const hues = await Promise.all(nodes.map(node => color({ status: node.id, workflow: { definition: { nodes } } })));
    assert.equal(new Set(hues).size, nodes.length);
    for (let i = 0; i < hues.length; i++) for (let j = i + 1; j < hues.length; j++) {
      const distance = Math.abs(hues[i] - hues[j]);
      assert.ok(Math.min(distance, 360 - distance) >= 20, "default workflow colours remain visually separated");
    }
  }
  const nodes = Array.from({ length: 100 }, (_, i) => ({ id: `custom-${i}`, name: `状态 ${i}` }));
  const hues = await Promise.all(nodes.map(node => color({ status: node.id, workflow: { definition: { nodes } } })));
  assert.equal(new Set(hues).size, 100);
  const reversed = [...nodes].reverse();
  assert.deepEqual(await Promise.all(nodes.map(node => color({ status: node.id, workflow: { definition: { nodes: reversed } } }))), hues);
});

test("cross-project issue list provides the same workflow nodes as issue detail", async () => {
  const nodes = defaultWorkflow("requirement").nodes;
  const row = { id: "issue", projectId: "project", title: "Example", type: "requirement", status: "planned", createdAt: new Date(), workflowVersion: { definition: { nodes } } };
  const result = presentWorkbenchPage("issues", { items: [row] }, [{ id: "project", name: "Project", status: "active" }]);
  assert.deepEqual(result.items[0].workflow.definition.nodes, nodes.map(({ id, name }) => ({ id, name })));
  assert.equal(await color(result.items[0]), await color({ ...row, workflow: row.workflowVersion }));
});
