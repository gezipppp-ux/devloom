const { updateConfig } = require("../../src/storage/json-files.cjs");

// Seed immutable clone metadata for tests unrelated to network cloning.
async function seedWorkspaceProject(file, repository, projectName = "fixture") {
  (await updateConfig(file, config => ({ ...config, execution: { ...config.execution, repository, projectName } })));
}
module.exports = { seedWorkspaceProject };
