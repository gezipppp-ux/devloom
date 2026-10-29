const { issueWorkflowNode } = require("../domain/issue-workflows.cjs");

async function activeTaskIds(client, where) {
  const tasks = await client.developmentTask.findMany({
    where: { ...where, status: { notIn: ["cancelled", "merged"] } },
    select: { id: true, status: true, issueLinks: { select: { issue: { include: { workflowVersion: true, deliverables: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } } } },
      deliverables: { where: { issueId: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } },
  });
  return tasks.filter(task => task.status === "completed" ? !task.issueLinks.length && task.deliverables[0]?.status === "returned" : task.issueLinks.length
    ? task.issueLinks.some(({ issue }) => {
      const node = issueWorkflowNode(issue), delivery = issue.deliverables[0];
      return !["completed", "cancelled"].includes(node.kind) && delivery?.status !== "pending" && (delivery?.status !== "accepted" || node.allowDevelopment);
    })
    : !["pending", "accepted"].includes(task.deliverables[0]?.status)).map(task => task.id);
}

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
      { status: { in: statuses.filter(status => !["active", "not_cancelled"].includes(status)) } },
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
module.exports = { workListWhere, activeTaskIds };
