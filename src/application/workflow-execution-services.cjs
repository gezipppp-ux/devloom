const { ProjectWorkflowServices } = require("./project-workflow-services.cjs");
const { WorkflowExecutionStore } = require("../storage/workflow-execution-store.cjs");
const { ProjectDevelopmentStore } = require("../storage/project-development-store.cjs");
const { workflowEventEdge } = require("../domain/workflow-handoffs.cjs");
const { issueWorkflowNode } = require("../domain/issue-workflows.cjs");
const { accountError } = require("../domain/account.cjs");
const { presentError } = require("./error-presenter.cjs");

class WorkflowExecutionServices {
  constructor(database, projects) { this.store = new WorkflowExecutionStore(database); this.development = new ProjectDevelopmentStore(database); this.workflow = new ProjectWorkflowServices(database, projects); this.projects = projects; }
  async prepare(task, actor) {
    if (task.snapshot.kind === "manual") return;
    const ids = [...task.snapshot.issues.map(issue => issue.id), ...task.snapshot.additions.filter(batch => ["sending", "sent"].includes(batch.status)).flatMap(batch => batch.issueIds)];
    const steps = [];
    let eligible = false;
    for (const issue of await this.development.issues(task.projectId, ids)) {
      const node = issueWorkflowNode(issue);
      if (!node.allowDevelopment) continue;
      eligible = true;
      const edges = issue.workflowVersion.definition.transitions.filter(edge => edge.from === issue.status && edge.trigger === "development.started");
      if (!edges.length && node.active && node.handler === "developer" && issue.developerId === actor.id) continue;
      const edge = workflowEventEdge(issue, "development.started");
      await this.workflow.validate(issue, actor, edge, { executorId: task.executorId });
      steps.push({ issueId: issue.id, actionId: issue.actions[0]?.id, revision: issue.revision, edgeId: edge.id });
    }
    if (!eligible) throw accountError("关联事项正在验证或已结束，当前没有可继续开发的范围。", 409);
    if (steps.length && JSON.stringify(task.snapshot.workflowIntent?.steps) !== JSON.stringify(steps)) await this.store.capture(task, steps);
  }
  async recoverTask(task, retry = false) {
    if (!task.runKey || task.snapshot.kind === "manual") return;
    await this.store.transaction(async () => this.store.discover(await this.development.task(task.projectId, task.id)));
    for (const event of await this.store.pending(task.id, retry)) {
      try {
        await this.store.transaction(async () => {
          if ((await this.store.event(event.id))?.status === "applied") return;
          const current = await this.development.task(task.projectId, task.id);
          if (!["started", "unknown"].includes(current.status) || current.executorId !== task.executorId) throw accountError("原开发任务已结束或执行归属改变，不能自动流转。", 409);
          await this.projects.authorize(task.projectId, { id: task.executorId }, "session.start");
          for (const step of event.steps) {
            const issue = await this.workflow.store.issue(task.projectId, step.issueId);
            if (issue.actions[0]?.id !== step.actionId || !retry && issue.revision !== step.revision) throw accountError("事项或处理轮次已变化，请核对原执行后处理流程。", 409);
            const edge = issue.workflowVersion.definition.transitions.find(edge => edge.id === step.edgeId && edge.trigger === "development.started");
            await this.workflow.apply(issue, { id: task.executorId }, edge, { executorId: task.executorId, turnId: event.turnId });
          }
          await this.store.result(event.id, "applied");
        });
      } catch (error) {
        await this.store.result(event.id, "blocked", presentError(error).message);
      }
    }
    await this.store.transaction(() => this.store.settle(task.id));
  }
  async event(workspaceId, runKey) {
    const task = await this.development.taskForRun(workspaceId, runKey);
    if (task) await this.recoverTask(task);
  }
}
module.exports = { WorkflowExecutionServices };
