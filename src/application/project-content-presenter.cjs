const { workflowActorAllowed } = require("../domain/workflow-handoffs.cjs");
const { issueDeletionReason } = require("../domain/issue-deletion.cjs");
const { issueWorkflowNode, issueDevelopmentAllowed } = require("../domain/issue-workflows.cjs");
const { workflowHandler } = require("../domain/workflow-actions.cjs");
const { deliverySubmission } = require("../domain/delivery-submission.cjs");

function dates(row) {
  return { ...row, ...(row.createdAt ? { createdAt: row.createdAt.toISOString() } : {}), ...(row.updatedAt ? { updatedAt: row.updatedAt.toISOString() } : {}) };
}
function presentIssueAssignment(record, developerId) {
  if (!record || !developerId || record.developerId !== developerId) return null;
  return { actorId: record.actorId, developerId, createdAt: record.createdAt.toISOString(), method: record.actorId === developerId ? "claimed" : "assigned" };
}
function presentIssue(row, actorId, permissions = []) {
  const { source, release, workflowVersion, developmentClaim, actions = [], deliverables = [], _count, deletedAt, ...issue } = row;
  const deletionReason = issueDeletionReason({ release, developmentClaim, _count });
  issue.deletion = { allowed: permissions.includes("issue.delete") && !deletionReason && !deletedAt, reason: deletionReason };
  const action = actions[0];
  issue.deliverySubmission = deliverySubmission(row, actorId, permissions);
  const needsAssignment = !workflowHandler(row, issueWorkflowNode(row));
  const processing = action ? { id: action.id, handlerId: action.handlerId, status: action.status, category: action.category, revision: action.revision, needsAssignment } : null;
  const workflowActions = release?.status === "archived" ? [] : workflowVersion.definition.transitions.filter(edge => edge.from === row.status).map(edge => {
    const next = workflowVersion.definition.nodes.find(node => node.id === edge.to);
    const allowed = permissions.includes(edge.permission) && workflowActorAllowed(row, edge, actorId, permissions, { reviewerId: deliverables[0]?.reviewerId })
      && (!edge.trigger.startsWith('verification.') || permissions.includes('deliverable.review') && deliverables[0]?.status === 'pending' && deliverables[0]?.actionId === action?.id);
    return { ...edge, allowed, status: edge.to, statusName: next.name, nextHandlerId: edge.assignment === "submitter" ? deliverables[0]?.authorId || null : edge.assignment === "executor" ? row.developerId : workflowHandler(row, next), terminal: ["completed", "cancelled"].includes(next.kind) };
  });
  return { ...dates(issue), processing, development: developmentClaim ? { taskId: developmentClaim.task.id, executorId: developmentClaim.task.executorId, executorName: developmentClaim.task.executor.displayName } : null, release: release ? { id: release.id, name: release.name, status: release.status } : null, workflow: { id: workflowVersion.workflowId, version: workflowVersion.version, latestPublishedVersion: workflowVersion.workflow?.publishedVersion ?? workflowVersion.version, definition: workflowVersion.definition }, statusName: issueWorkflowNode(row)?.name || row.status, developmentAllowed: issueDevelopmentAllowed(row), assignmentAllowed: issueWorkflowNode(row)?.allowAssignment === true, workflowActions, availableTransitions: workflowActions.filter(edge => edge.trigger === "manual" && permissions.includes(edge.permission) && (!actorId || workflowActorAllowed(row, edge, actorId, permissions))), source: source ? { channel: source.channel, scope: source.scope, type: source.type, externalId: source.externalId, url: source.url, capturedAt: source.capturedAt.toISOString() } : null };
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
function presentPage(page, present = dates) { return { ...page, items: page.items.map(row => present(row)) }; }
function presentDeliverable(row) {
  return { id: row.id, projectId: row.projectId, issueId: row.issueId, authorId: row.authorId, taskId: row.taskId,
    supersedesId: row.supersedesId || null, supersededById: row.next?.id || null,
    reviewerId: row.reviewerId, verificationStartedAt: row.verificationStartedAt?.toISOString() || null, title: row.title, body: row.body, commit: row.commit, status: row.status, revision: row.revision,
    checklist: row.checklist, checkedItems: row.checkedItems, reviewNote: row.reviewNote,
    reviewedById: row.reviewedById, reviewedAt: row.reviewedAt?.toISOString() || null, createdAt: row.createdAt.toISOString() };
}

module.exports = { presentIssueImages, presentIssue, presentIssueAssignment, presentAsset, presentProjectFile, presentPage, presentDeliverable };
