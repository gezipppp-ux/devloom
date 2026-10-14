function timestamp(value) { return value instanceof Date ? value.toISOString() : value || ""; }
function presentAttention(deliveries, requests, projects) {
  const directory = new Map(projects.map(project => [project.id, project]));
  const items = [
    ...deliveries.map(row => ({ id: `delivery:${row.id}:${row.revision}`, kind: "delivery", deliveryId: row.id, projectId: row.projectId, projectName: directory.get(row.projectId).name, title: row.title || row.issue.title, updatedAt: timestamp(row.createdAt) })),
    ...requests.flatMap(({ projectId, workspaceId, sessions }) => sessions.flatMap(session => session.requests.map(request => ({
      id: `${workspaceId}:${session.key}:${request.turnId}:${request.id}`, kind: request.kind === "user-input" ? "question" : "approval", projectId, projectName: directory.get(projectId).name, workspaceId, runKey: session.key, title: session.title, updatedAt: timestamp(session.updatedAt),
    })))),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  return { items, total: items.length };
}
module.exports = { presentAttention };
