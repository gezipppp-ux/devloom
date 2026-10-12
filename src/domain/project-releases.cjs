const { accountError } = require("./account.cjs");
const releaseNameRules = require("../../shared/project-release-name.json");

const releaseNamePattern = new RegExp(`^(?:${releaseNameRules.pattern})$`);

function releaseName(value) {
  if (typeof value !== "string" || value.length > releaseNameRules.maxLength || value !== value.trim() || !releaseNamePattern.test(value))
    throw accountError(releaseNameRules.error, 400);
  return value;
}

module.exports = { releaseName };
