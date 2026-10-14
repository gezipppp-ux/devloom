const { issueWorkflowNode } = require("../domain/issue-workflows.cjs");

function presentWorkbenchPage(kind, page, projects) {
  return { ...page, items: page.items.map(row => {
    const project = projects.find(item => item.id === row.projectId);
    const base = { id: row.id, projectId: row.projectId, projectName: project.name, projectArchived: project.status === "archived", title: row.title, status: row.status, createdAt: row.createdAt.toISOString() };
    if (kind === "issues") return { ...base, number: row.number, type: row.type, priority: row.priority, statusName: issueWorkflowNode(row)?.name || row.status,
      completed: ["completed", "cancelled"].includes(issueWorkflowNode(row)?.kind), assigneeId: row.assigneeId, dueDate: row.dueDate, tags: row.tags, releaseName: row.release?.name || "" };
    if (kind === "tasks") return { ...base, title: row.snapshot.title, executorId: row.executorId, releaseName: row.release?.name || "", runKey: row.runKey, workspaceId: row.workspaceId };
    return { ...base, title: row.title || row.issue.title, issue: row.issue, authorId: row.authorId, commit: row.commit, reviewedAt: row.reviewedAt?.toISOString() || null };
  }) };
}
module.exports = { presentWorkbenchPage };
