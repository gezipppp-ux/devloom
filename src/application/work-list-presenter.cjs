function presentWorkFilters({ releases, people, workflows }) {
  const statuses = new Map();
  for (const workflow of workflows) for (const node of workflow.definition.nodes) {
    const names = statuses.get(node.id) || new Set();
    names.add(node.name); statuses.set(node.id, names);
  }
  return {
    releases: releases.map(({ id, projectId, name, status, project }) => ({ id, projectId, name, status, projectName: project.name })),
    people: people.map(({ id, displayName }) => ({ id, displayName })),
    statuses: [...statuses].map(([id, names]) => ({ id, name: [...names].join(" / ") })),
  };
}
module.exports = { presentWorkFilters };
