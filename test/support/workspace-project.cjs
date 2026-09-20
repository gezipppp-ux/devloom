const { updateConfig } = require("../../src/storage/json-files.cjs");

// Seed immutable clone metadata for tests unrelated to network cloning.
function seedWorkspaceProject(file, repository, projectName = "fixture") {
  updateConfig(file, config => ({ ...config, codex: { ...config.codex, repository, project_name: projectName } }));
}
module.exports = { seedWorkspaceProject };
