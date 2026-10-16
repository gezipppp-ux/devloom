const { ProjectDevelopmentStore } = require("./project-development-store.cjs");

class WorkflowExecutionStore {
  constructor(database) { this.database = database; this.development = new ProjectDevelopmentStore(database); }
  async transaction(operation) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.database.transaction(operation); }
      catch (error) { if (error.code !== "P2034" || attempt >= 3) throw error; }
    }
  }
  path(task) { return `workspaces/${task.workspaceId}/runs/${task.runKey}/agent-events.jsonl`; }
  async markDispatch(task) {
    const run = await this.database.client.run.findFirst({ where: { workspaceId: task.workspaceId, runKey: task.runKey } });
    if (run) await this.database.client.run.update({ where: { path: run.path }, data: { executionState: "starting", data: { ...run.data, execution: { ...run.data.execution, status: "starting" } } } });
  }
  async capture(task, steps) {
    const latest = await this.database.client.logChunk.findFirst({ where: { path: this.path(task) }, orderBy: { id: "desc" }, select: { id: true } });
    return this.development.update(task, { snapshot: { ...task.snapshot, workflowIntent: { afterLogId: latest?.id || 0, steps } } });
  }
  async discover(task) {
    if (!task.runKey) return;
    const intent = task.snapshot.workflowIntent;
    if (!intent?.steps.length) return;
    const recorded = await this.database.client.workflowExecutionEvent.findFirst({ where: { taskId: task.id }, orderBy: { createdAt: "desc" } });
    if (recorded && JSON.stringify(recorded.steps) === JSON.stringify(intent.steps)) return;
    const chunks = await this.database.client.logChunk.findMany({ where: { path: this.path(task), id: { gt: intent.afterLogId } }, orderBy: { id: "asc" } });
    for (const chunk of chunks) for (const line of Buffer.from(chunk.data).toString("utf8").split("\n").filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.type !== "turn-started" || !event.turn?.id) continue;
      const existing = await this.database.client.workflowExecutionEvent.findUnique({ where: { taskId_turnId: { taskId: task.id, turnId: event.turn.id } } });
      if (existing) { if (JSON.stringify(existing.steps) === JSON.stringify(intent.steps)) return; continue; }
      await this.database.client.workflowExecutionEvent.create({ data: { taskId: task.id, turnId: event.turn.id, steps: intent.steps } });
      return;
    }
  }
  pending(taskId, retry) { return this.database.client.workflowExecutionEvent.findMany({ where: { taskId, status: { in: retry ? ["pending", "blocked"] : ["pending"] } }, orderBy: { createdAt: "asc" } }); }
  event(id) { return this.database.client.workflowExecutionEvent.findUnique({ where: { id } }); }
  result(id, status, error = null) { return this.database.client.workflowExecutionEvent.updateMany({ where: { id, status: { not: "applied" } }, data: { status, error } }); }
  async settle(taskId) {
    const task = await this.database.client.developmentTask.findUnique({ where: { id: taskId }, include: { issueLinks: { include: { issue: { include: { workflowVersion: true } } } }, deliverables: { where: { status: { in: ["pending", "returned"] }, next: { is: null } } } } });
    if (!task || !["planned", "started"].includes(task.status) || task.snapshot.kind === "manual" || !task.issueLinks.length || task.deliverables.length) return;
    if (task.issueLinks.some(({ issue }) => !["completed", "cancelled"].includes(issue.workflowVersion.definition.nodes.find(node => node.id === issue.status)?.kind))) return;
    if (task.runKey || task.status === "started") {
      const execution = await this.development.execution(task);
      if (!["completed", "failed", "interrupted", "cancelled"].includes(execution?.status)) return;
    } else if (task.snapshot.startRequest || task.snapshot.workflowIntent || await this.database.client.workflowExecutionEvent.count({ where: { taskId } })) return;
    await this.development.finish(task, "completed", task.executorId);
  }
  async taskIds(issueId) {
    return (await this.database.client.issueDevelopmentClaim.findMany({ where: { issueId }, select: { taskId: true } })).map(row => row.taskId);
  }
}
module.exports = { WorkflowExecutionStore };
