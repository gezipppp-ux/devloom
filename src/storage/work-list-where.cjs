function nullable(field, values) {
  return { OR: [...(values.includes("none") ? [{ [field]: null }] : []), ...(values.some(value => value !== "none") ? [{ [field]: { in: values.filter(value => value !== "none") } }] : [])] };
}
function workListWhere(kind, filters) {
  if (!filters) return [];
  const { statuses = [], releases = [], owners = [], reporters = [], priorities = [] } = filters;
  const clauses = [];
  if (statuses.length) {
    if (kind !== "tasks") clauses.push({ status: { in: statuses } });
    else if (!statuses.includes("all")) clauses.push({ OR: [
      ...(statuses.includes("not_cancelled") ? [{ status: { not: "cancelled" } }] : []),
      { status: { in: statuses.filter(status => status !== "not_cancelled") } },
    ] });
  }
  if (priorities.length && kind === "issues") clauses.push({ priority: { in: priorities } });
  if (owners.length && kind !== "deliveries") clauses.push(nullable(kind === "tasks" ? "executorId" : "developerId", owners));
  if (releases.length) clauses.push(kind === "deliveries" ? { OR: [
    { issue: nullable("releaseId", releases) },
    { issueId: null, task: nullable("releaseId", releases) },
    ...(releases.includes("none") ? [{ issueId: null, taskId: null }] : []),
  ] } : nullable("releaseId", releases));
  if (reporters.length) {
    const reporter = { reporterId: { in: reporters.filter(id => id !== "none") }, deletedAt: null };
    if (kind === "issues") clauses.push(reporter);
    else if (kind === "tasks") clauses.push({ OR: [
      { issueLinks: { some: { issue: reporter } } },
      ...(reporters.includes("none") ? [{ issueLinks: { none: {} } }] : []),
    ] });
    // A delivery belongs to its submitted issue, not every issue in the task.
    else clauses.push({ OR: [{ issue: reporter }, ...(reporters.includes("none") ? [{ issueId: null }] : [])] });
  }
  return clauses;
}
module.exports = { workListWhere };
