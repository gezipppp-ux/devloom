export function workLocation(kind, item) {
  if (kind === "deliveries") return { name: "deliveries", query: { projectId: item.projectId, delivery: item.id } };
  return { name: "project", params: { projectId: item.projectId }, query: kind === "tasks" ? { tab: "tasks", task: item.id } : { tab: item.type === "bug" ? "bugs" : "issues", issue: item.id } };
}
