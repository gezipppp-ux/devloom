class WorkListFilterStore {
  constructor(database) { this.database = database; }
  async options(projectIds, { type, executorId } = {}) {
    const client = this.database.client;
    const scope = { projectId: { in: projectIds } };
    // The global development queue exposes only the actor's tasks. Its metadata
    // must not reveal unrelated issues, workflow definitions or release names.
    const taskScope = { ...scope, ...(executorId ? { executorId } : {}) };
    const [releases, memberships, issues, tasks, workflows, published] = await Promise.all([
      client.projectRelease.findMany({ where: { ...scope, ...(executorId ? { tasks: { some: taskScope } } : {}) }, select: { id: true, name: true, projectId: true, status: true, project: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
      executorId ? [] : client.projectMember.findMany({ where: scope, select: { userId: true } }),
      client.projectIssue.findMany({ where: { ...scope, deletedAt: null, ...(executorId ? { taskLinks: { some: { task: taskScope } } } : {}) }, select: { reporterId: true, developerId: true }, distinct: ["reporterId", "developerId"] }),
      client.developmentTask.findMany({ where: taskScope, select: { executorId: true }, distinct: ["executorId"] }),
      executorId ? [] : client.systemWorkflowVersion.findMany({ where: { issues: { some: { ...scope, deletedAt: null, ...(type ? { type } : {}) } } }, select: { id: true, definition: true } }),
      executorId || !projectIds.length ? [] : client.systemWorkflow.findMany({ where: type ? { type } : {}, select: { versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, definition: true } } } }),
    ]);
    const ids = [...new Set([...memberships.map(member => member.userId), ...issues.flatMap(issue => [issue.reporterId, issue.developerId]), ...tasks.map(task => task.executorId)].filter(Boolean))];
    const people = await client.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } });
    return { releases, people, workflows: [...workflows, ...published.flatMap(workflow => workflow.versions)] };
  }
}
module.exports = { WorkListFilterStore };
