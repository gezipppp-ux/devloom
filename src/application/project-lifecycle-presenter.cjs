function presentRelease(row) { return { id: row.id, projectId: row.projectId, name: row.name, description: row.description, status: row.status, revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
module.exports = { presentRelease };
