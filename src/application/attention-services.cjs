const { AttentionStore } = require("../storage/attention-store.cjs");
const { presentAttention } = require("./attention-presenter.cjs");

class AttentionServices {
  constructor(database, { projects, workspaces }) { this.store = new AttentionStore(database); this.projects = projects; this.workspaces = workspaces; }
  async list(actor) {
    const directory = await this.projects.list(actor);
    const active = directory.projects.filter(project => project.status === "active");
    const deliveryProjects = active.filter(project => ["collaboration.view", "issue.view", "deliverable.review"].every(permission => project.permissions.includes(permission)));
    const sessionProjects = active.filter(project => ["session.view", "session.approve"].every(permission => project.permissions.includes(permission)));
    const deliveries = await this.store.pendingDeliveries(deliveryProjects.map(project => project.id));
    const requests = [];
    for (const space of await this.store.ownedSpaces(actor.id)) {
      if (!sessionProjects.some(project => project.id === space.projectId)) continue;
      await this.projects.workspaceAuthorization(space.workspaceId, actor, "session.approve");
      const pending = await this.workspaces.pendingRequests(space.workspaceId, actor);
      const unavailable = new Set((await this.store.unavailableRuns(space.workspaceId, actor.id)).map(task => task.runKey));
      const sessions = pending.filter(session => !unavailable.has(session.key));
      await this.projects.workspaceAuthorization(space.workspaceId, actor, "session.approve");
      requests.push({ projectId: space.projectId, workspaceId: space.workspaceId, sessions });
    }
    // Any revocation during aggregation invalidates the complete response, including totals.
    for (const project of deliveryProjects) for (const permission of ["collaboration.view", "issue.view", "deliverable.review"]) await this.projects.authorize(project.id, actor, permission);
    for (const project of sessionProjects) for (const permission of ["session.view", "session.approve"]) await this.projects.authorize(project.id, actor, permission);
    return presentAttention(deliveries, requests, active);
  }
}
module.exports = { AttentionServices };
