const { issueWorkflowNode, issueDevelopmentAllowed } = require("../domain/issue-workflows.cjs");
const { issueTransitions } = require("../domain/project-issues.cjs");

function dates(row) {
  return { ...row, ...(row.createdAt ? { createdAt: row.createdAt.toISOString() } : {}), ...(row.updatedAt ? { updatedAt: row.updatedAt.toISOString() } : {}) };
}
function presentIssue(row) {
  const { source, release, workflowVersion, developmentClaim, ...issue } = row;
  return { ...dates(issue), development: developmentClaim ? { taskId: developmentClaim.task.id, executorId: developmentClaim.task.executorId, executorName: developmentClaim.task.executor.displayName } : null, release: release ? { id: release.id, name: release.name, status: release.status } : null, workflow: { id: workflowVersion.workflowId, version: workflowVersion.version, definition: workflowVersion.definition }, statusName: issueWorkflowNode(row)?.name || row.status, developmentAllowed: issueDevelopmentAllowed(row), availableTransitions: release?.status === "archived" ? [] : issueTransitions(row), source: source ? { channel: source.channel, scope: source.scope, type: source.type, externalId: source.externalId, url: source.url, capturedAt: source.capturedAt.toISOString() } : null };
}
function presentIssueImages(rows, source) {
  const files = rows.map(presentProjectFile);
  const images = files.map(file => ({ source: file.url, url: file.previewUrl }));
  // An imported reference may only resolve to a verified file of this issue.
  for (const reference of source?.snapshot?.projectImages || []) {
    const file = files.find(file => file.id === reference.fileId);
    if (file?.previewUrl && typeof reference.source === "string")
      images.push({ source: reference.source, url: file.previewUrl });
  }
  return images;
}
function presentAsset(row) {
  const { secret, issueLinks = [], ...asset } = row;
  return { ...dates(asset), expiresAt: row.expiresAt?.toISOString() || null, issueIds: issueLinks.map(link => link.issueId), hasSecret: Boolean(secret) };
}
function presentProjectFile(row) {
  return { id: row.id, projectId: row.projectId, issueId: row.issueId, assetId: row.assetId, authorId: row.authorId,
    previewUrl: row.previewMimeType ? `/api/projects/${row.projectId}/files/${row.id}?inline=1` : null,
    name: row.name, mimeType: row.mimeType, size: row.size, createdAt: row.createdAt.toISOString(), url: `/api/projects/${row.projectId}/files/${row.id}` };
}
function presentPage(page, present = dates) { return { ...page, items: page.items.map(present) }; }

module.exports = { presentIssueImages, presentIssue, presentAsset, presentProjectFile, presentPage };
