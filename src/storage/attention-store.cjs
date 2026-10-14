class AttentionStore {
  constructor(database) { this.database = database; }
  async ownedSpaces(actorId) {
    return this.database.client.developmentSpace.findMany({
      where: { userId: actorId, status: "ready", workspace: { ownerUserId: actorId } },
      select: { projectId: true, workspaceId: true },
    });
  }
  async pendingDeliveries(projectIds) {
    return this.database.client.issueDeliverable.findMany({
      where: { projectId: { in: projectIds }, status: "pending", issue: { OR: [{ releaseId: null }, { release: { status: { not: "archived" } } }] } },
      select: { id: true, projectId: true, title: true, createdAt: true, revision: true, issue: { select: { id: true, title: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }
  async unavailableRuns(workspaceId, actorId) {
    return this.database.client.developmentTask.findMany({
      where: { workspaceId, runKey: { not: null }, OR: [{ executorId: { not: actorId } }, { status: { in: ["completed", "cancelled", "merged"] } }, { release: { status: "archived" } }] },
      select: { runKey: true },
    });
  }
}
module.exports = { AttentionStore };
