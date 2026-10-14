const { issueWorkflowNode } = require("../domain/issue-workflows.cjs");
const { presentDevelopment } = require("./project-development-presenter.cjs");

function presentWorkbenchPage(kind, page, projects, actorId) {
  return { ...page, items: page.items.map(row => {
    const project = projects.find(item => item.id === row.projectId);
    const base = { id: row.id, projectId: row.projectId, projectName: project.name, projectArchived: project.status === "archived", title: row.title, status: row.status, createdAt: row.createdAt.toISOString() };
    if (kind === "issues") return { ...base, number: row.number, type: row.type, priority: row.priority, statusName: issueWorkflowNode(row)?.name || row.status,
      completed: ["completed", "cancelled"].includes(issueWorkflowNode(row)?.kind), developerId: row.developerId, dueDate: row.dueDate, tags: row.tags, releaseName: row.release?.name || "" };
    if (kind === "tasks") return { ...base, ...presentDevelopment(row, actorId, null, { permissions: project.permissions, projectStatus: project.status }), releaseName: row.release?.name || "" };
    return { ...base, title: row.title, issue: row.issue, authorId: row.authorId, commit: row.commit, reviewedAt: row.reviewedAt?.toISOString() || null };
  }) };
}
function presentRecentProjects(visits, projects) {
  return { projects: visits.map(visit => {
    const project = projects.find(project => project.id === visit.projectId);
    return { id: project.id, name: project.name, status: project.status, memberCount: project.memberCount, lastVisitedAt: visit.lastVisitedAt.toISOString() };
  }) };
}
function presentProjectActivity(projectId, { items, people }) {
  return { items: items.map(row => ({ id: row.id, projectId, action: row.action, createdAt: row.createdAt.toISOString(),
    actorName: people.find(person => person.id === row.actorId)?.displayName || "", issue: row.issue, title: row.title,
    ...(row.deliveryId ? { deliveryId: row.deliveryId } : {}) })) };
}
module.exports = { presentWorkbenchPage, presentRecentProjects, presentProjectActivity };
