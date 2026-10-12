function presentWorkflow(row, { publishedOnly = false } = {}) {
  return { workflow: { id: row.id, type: row.type,
    ...(!publishedOnly ? { revision: row.revision, draft: row.draft } : {}),
    publishedVersion: row.publishedVersion,
    versions: row.versions.map(version => ({ id: version.id, version: version.version, definition: version.definition, createdAt: version.createdAt.toISOString() })),
  } };
}
module.exports = { presentWorkflow };
