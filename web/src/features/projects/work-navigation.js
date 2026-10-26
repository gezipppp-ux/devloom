export function workLocation(kind, item, returnTo) {
  if (kind === "deliveries") return { name: "deliveries", query: { projectId: item.projectId, delivery: item.id, ...(returnTo ? { returnTo } : {}) } };
  return { name: "project", params: { projectId: item.projectId }, query: { ...(kind === "tasks" ? { tab: "tasks", task: item.id } : { tab: item.type === "bug" ? "bugs" : "issues", issue: item.id }), ...(returnTo ? { returnTo } : {}) } };
}

// Only resource queues can be a detail's external return destination.
export function workReturnLocation(router, route, kind) {
  const value = route.query.returnTo;
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  const target = router.resolve(value);
  if (target.name !== (kind === "tasks" ? "development" : kind === "deliveries" ? "deliveries" : "issues")) return null;
  if (target.query.issue || target.query.task || target.query.delivery || target.query.create || target.query.returnTo) return null;
  return target;
}

export function issueCreateLocation(projectId, target, returnTo) {
  return { name: "project", params: { projectId }, query: { tab: target === "bugs" ? "bugs" : "issues", create: "1", returnTo } };
}
