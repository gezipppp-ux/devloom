const { randomUUID } = require("node:crypto");

function fixtureWorkspaceClones(workspaces) {
  const clones = new Map();
  return {
    async start(input) {
      const workspace = await workspaces.save({ name: input.name, icon: input.icon ?? null });
      const clone = { id: randomUUID(), name: input.name, status: "completed", progress: { stage: "publishing", percent: null }, workspace };
      clones.set(clone.id, clone);
      return clone;
    },
    list() { return [...clones.values()]; },
    read(id) { return clones.get(id); },
    dismiss(id) { clones.delete(id); },
    async close() {},
  };
}
async function waitForClone(read) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const clone = await read();
    if (clone.status !== "running") return clone;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error("fixture clone did not finish");
}
module.exports = { fixtureWorkspaceClones, waitForClone };
