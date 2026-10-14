const { accountError } = require("./account.cjs");
const releaseNameRules = require("../../shared/project-release-name.json");

const releaseNamePattern = new RegExp(`^(?:${releaseNameRules.pattern})$`);

function releaseName(value) {
  if (typeof value !== "string" || value.length > releaseNameRules.maxLength || value !== value.trim() || !releaseNamePattern.test(value))
    throw accountError(releaseNameRules.error, 400);
  return value;
}

function releaseTargetDate(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    throw accountError("目标日期须为有效的 YYYY-MM-DD 日期。", 400);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw accountError("目标日期须为有效的 YYYY-MM-DD 日期。", 400);
  return date;
}

module.exports = { releaseName, releaseTargetDate };
