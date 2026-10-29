const { identifiers, choice, PRIORITIES } = require("./project-issues.cjs");
const { developmentStatus } = require("./project-development.cjs");
const { accountError } = require("./account.cjs");

function values(input, label) {
  if (input === undefined || input === "") return [];
  if (typeof input !== "string" || input.length > 5000) throw accountError(`${label}筛选无效。`, 400);
  return identifiers(input.split(","), label);
}
function workListFilters(input, kind) {
  const statuses = values(input.status, "状态");
  if (kind === "tasks") statuses.forEach(developmentStatus);
  if (kind === "tasks" && statuses.includes("active") && statuses.length > 1) throw accountError("需要开发筛选不能与其他任务状态同时使用。", 400);
  if (kind === "deliveries") statuses.forEach(value => choice(value, ["pending", "accepted", "returned"], "验收状态"));
  const priorities = values(input.priority, "优先级");
  priorities.forEach(value => choice(value, PRIORITIES, "优先级"));
  return {
    statuses: kind === "tasks" && !statuses.length ? ["not_cancelled"] : statuses,
    releases: values(input.releaseId, "版本").map(value => value === "unassigned" ? "none" : value),
    owners: values(input.ownerId, "负责人"), reporters: values(input.reporterId, "提报人"), priorities,
  };
}
module.exports = { workListFilters };
