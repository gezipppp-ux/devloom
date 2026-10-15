function presentDevelopment(task, actorId, execution = null, { detail = false, permissions = [], projectStatus = "active" } = {}) {
  const snapshot = task.snapshot;
  const additions = snapshot.additions || [];
  const own = actorId === task.executorId;
  const privateSession = own && permissions.includes("session.view");
  const writable = projectStatus === "active" && task.release?.status !== "archived";
  const canManage = writable && (own ? permissions.includes("session.start") : permissions.includes("issue.assign"));
  const scope = (task.issueLinks || []).map(({ issue }) => ({ id: issue.id, title: issue.title, status: issue.status, statusName: issue.workflowVersion.definition.nodes.find(node => node.id === issue.status)?.name, complete: ["completed", "cancelled"].includes(issue.workflowVersion.definition.nodes.find(node => node.id === issue.status)?.kind), delivery: issue.deliverables?.[0] ? { id: issue.deliverables[0].id, status: issue.deliverables[0].status } : null }));
  const deliveryPhase = scope.some(issue => issue.delivery?.status === "returned") ? "待返工" : scope.length && scope.every(issue => issue.complete || issue.delivery?.status === "pending" || issue.delivery?.status === "accepted") ? "等待验证" : "";
  const open = !["completed", "cancelled", "merged"].includes(task.status);
  const idle = !task.runKey || ["completed", "failed", "interrupted", "cancelled"].includes(execution?.status);
  return { id: task.id, projectId: task.projectId, executorId: task.executorId, title: snapshot.title, kind: snapshot.kind || "issues", scope, deliveryPhase, workflowErrors: (task.workflowEvents || []).map(event => ({ id: event.id, error: event.error })),
    mergedIntoTaskId: snapshot.mergedIntoTaskId || null, mergedFromTaskIds: snapshot.mergedFromTaskIds || [],
    canMerge: writable && own && permissions.includes("session.start") && task.status === "planned",
    executor: task.executor || null, releaseId: task.releaseId, release: task.release ? { id: task.release.id, name: task.release.name, status: task.release.status } : null,
    workspaceId: privateSession ? task.workspaceId : null, runKey: privateSession ? task.runKey : null, status: task.status, error: privateSession ? task.error : null, revision: task.revision,
    canStart: writable && own && permissions.includes("session.start") && task.status === "planned", canEdit: canManage && task.status === "planned", canComplete: canManage && open && idle && task.status !== "planned" && (snapshot.kind === "manual" || scope.length > 0 && scope.every(issue => issue.complete)), canCancel: canManage && open && idle && !scope.some(issue => issue.delivery?.status === "pending"),
    baseBranch: snapshot.baseBranch || "", baseCommit: execution?.baseline?.commit || null, fetchedAt: execution?.baseline?.fetchedAt || null,
    execution: privateSession && execution ? { status: execution.status, error: execution.error || null, sessionId: execution.sessionId } : null, canOpenSession: privateSession && Boolean(task.runKey), createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    issueIds: [...snapshot.issues.map(issue => issue.id), ...additions.flatMap(batch => batch.issueIds)],
    additions: additions.map(batch => ({ requestId: batch.requestId, issueIds: batch.issueIds, status: batch.status, error: privateSession ? batch.error || null : null, createdAt: batch.createdAt, sentAt: batch.sentAt || null })),
    ...(detail ? { issues: snapshot.issues, manualContent: snapshot.manual?.content, selection: privateSession ? snapshot.selection : undefined, additions: additions.map(batch => ({ requestId: batch.requestId, issueIds: batch.issueIds, issues: batch.issues, status: batch.status, createdAt: batch.createdAt, sentAt: batch.sentAt || null })) } : {}) };
}

module.exports = { presentDevelopment };
