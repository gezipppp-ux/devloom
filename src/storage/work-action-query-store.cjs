class WorkActionQueryStore {
  constructor(database) { this.database = database; }
  async ownedSpaces(actorId) {
    return this.database.client.developmentSpace.findMany({ where: { userId: actorId, status: "ready", workspace: { ownerUserId: actorId } }, select: { projectId: true, workspaceId: true } });
  }
  async snapshot(projectIds, actorId) {
    return this.database.transaction(async () => {
      const client = this.database.client;
      const scope = { projectId: { in: projectIds } };
      const release = { OR: [{ releaseId: null }, { release: { status: "active" } }] };
      const actions = await client.workAction.findMany({ where: { ...scope, OR: [{ handlerId: actorId }, { issue: { businessOwnerId: actorId } }], status: { in: ["ready", "active"] }, issue: { ...release, deletedAt: null } }, include: { issue: { include: { workflowVersion: true, developmentClaim: { include: { task: { select: { executorId: true } } } } } } } });
      const tasks = await client.developmentTask.findMany({ where: { ...scope, status: { notIn: ["cancelled", "merged"] }, AND: [release, { OR: [
        { executorId: actorId }, { issueLinks: { some: { issue: { ...release, businessOwnerId: actorId } } } },
        { creatorId: actorId, snapshot: { path: ["kind"], equals: "manual" } },
      ] }] }, include: { workflowEvents: { where: { status: "blocked" } }, issueLinks: { include: { issue: { include: { workflowVersion: true, release: true, deliverables: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } } } } } });
      const deliveries = await client.projectDeliverable.findMany({ where: { ...scope, AND: [{ OR: [{ status: "pending", OR: [{ reviewerId: actorId }, { issue: { businessOwnerId: actorId } }, { issueId: null, authorId: actorId }] }, { authorId: actorId, status: "returned", next: { is: null } }] }, { OR: [{ issueId: null }, { issue: release }] }] }, include: { issue: { select: { title: true, number: true, dueDate: true, priority: true, businessOwnerId: true, status: true, workflowVersion: true } } } });
      const ownRuns = tasks.filter(task => task.executorId === actorId && task.runKey);
      const runs = ownRuns.length ? await client.run.findMany({ where: { ownerUserId: actorId, OR: ownRuns.map(task => ({ workspaceId: task.workspaceId, runKey: task.runKey })) }, select: { workspaceId: true, runKey: true, executionState: true, data: true } }) : [];
      const linkedRuns = await client.developmentTask.findMany({ where: { ...scope, runKey: { not: null } }, select: { workspaceId: true, runKey: true } });
      return { actions, linkedRuns, tasks: tasks.map(task => { const run = runs.find(run => run.workspaceId === task.workspaceId && run.runKey === task.runKey); return { ...task, execution: run ? { status: run.executionState || run.data?.execution?.status } : task.snapshot.sessionDeletion?.execution || null }; }), deliveries };
    });
  }
}
module.exports = { WorkActionQueryStore };
