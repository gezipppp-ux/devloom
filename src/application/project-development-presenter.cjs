function presentDevelopment(task, actorId, execution = null, { detail = false } = {}) {
  const snapshot = task.snapshot;
  const additions = snapshot.additions || [];
  return { id: task.id, projectId: task.projectId, executorId: task.executorId, title: snapshot.title,
    workspaceId: task.workspaceId, runKey: task.runKey, status: task.status, error: task.error, revision: task.revision,
    execution, canOpenSession: actorId === task.executorId, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    issueIds: [...snapshot.issues.map(issue => issue.id), ...additions.flatMap(batch => batch.issueIds)],
    additions: additions.map(batch => ({ requestId: batch.requestId, issueIds: batch.issueIds, status: batch.status, error: batch.error || null, createdAt: batch.createdAt, sentAt: batch.sentAt || null })),
    ...(detail ? { issues: snapshot.issues, selection: snapshot.selection, additions: additions.map(({ prompt: _prompt, messageImageIds: _images, ...batch }) => batch) } : {}) };
}

module.exports = { presentDevelopment };
