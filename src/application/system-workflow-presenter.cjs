const { recommendedWorkflow } = require("../domain/recommended-workflow.cjs");
const { responsibilityPermissions } = require("../domain/workflow-actions.cjs");

function presentWorkflow(row, { publishedOnly = false } = {}) {
  return { ...(!publishedOnly ? { recommendedDefinition: recommendedWorkflow(row.type) } : {}), workflow: { id: row.id, type: row.type,
    ...(!publishedOnly ? { revision: row.revision, draft: row.draft } : {}),
    publishedVersion: row.publishedVersion,
    versions: row.versions.map(version => ({ id: version.id, version: version.version, definition: version.definition, responsibilityPermissions: responsibilityPermissions(version.definition), createdAt: version.createdAt.toISOString() })),
  } };
}
module.exports = { presentWorkflow };
