function presentWorkspaceClone(row) {
  const input = JSON.parse(row.input_json);
  return {
    id: row.id, name: input.name, status: row.status,
    progress: JSON.parse(row.progress_json),
    workspace: row.workspace_json ? JSON.parse(row.workspace_json) : null,
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
module.exports = { presentWorkspaceClone };
