class WorkbenchStore {
  constructor(database) { this.database = database; }
  async recentProjects(userId, projectIds) {
    return this.database.client.userProjectVisit.findMany({ where: { userId, projectId: { in: projectIds } },
      orderBy: [{ lastVisitedAt: "desc" }, { projectId: "asc" }], take: 3 });
  }
  async activity(projectId, { deliveries }) {
    const client = this.database.client;
    const history = await client.issueHistory.findMany({ where: { projectId, action: { in: ["created", "updated", "transition", ...(deliveries ? ["delivery.reviewed"] : [])] } },
      include: { issue: { select: { id: true, title: true, type: true, number: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10 });
    const published = deliveries ? await client.projectDeliverable.findMany({ where: { projectId }, select: { id: true, issueId: true, authorId: true, title: true, createdAt: true,
      issue: { select: { id: true, title: true, type: true, number: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10 }) : [];
    const items = [...history.map(row => ({ id: row.id, action: row.action, actorId: row.actorId, createdAt: row.createdAt, issue: row.issue,
      deliveryId: row.action === "delivery.reviewed" ? row.data?.deliveryId : undefined })),
    ...published.map(row => ({ id: row.id, action: "delivery.published", actorId: row.authorId, createdAt: row.createdAt, issue: row.issue, title: row.title, deliveryId: row.id }))]
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, 10);
    const people = await client.user.findMany({ where: { id: { in: [...new Set(items.map(row => row.actorId))] } }, select: { id: true, displayName: true } });
    return { items, people };
  }
  async list(kind, projectIds, actorId, { limit, offset, query, scope, type, priority, status, tag, active }) {
    const client = this.database.client;
    const projects = { projectId: { in: projectIds } };
    let table, where, include;
    if (kind === "issues") {
      table = client.projectIssue;
      where = { ...projects, ...(type ? { type } : {}), ...(priority ? { priority } : {}), ...(status ? { status } : {}), ...(tag ? { tags: { has: tag } } : {}),
        AND: [
          ...(scope === "mine" ? [{ OR: ["developerId", "reporterId", "businessOwnerId", "qaOwnerId", "acceptanceOwnerId", "createdById"].map(field => ({ [field]: actorId })).concat({ watcherIds: { has: actorId } }) }] : []),
          ...(query ? [{ OR: [{ title: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }, { tags: { has: query } }] }] : []),
        ] };
      include = { release: true, workflowVersion: true };
      if (active) {
        const versions = await client.systemWorkflowVersion.findMany({ select: { id: true, definition: true } });
        where.AND.push({ OR: versions.map(version => ({ workflowVersionId: version.id, status: { in: version.definition.nodes.filter(node => !["completed", "cancelled"].includes(node.kind)).map(node => node.id) } })) });
      }
    } else if (kind === "tasks") {
      table = client.developmentTask;
      where = { ...projects, executorId: actorId, status: status || { not: "merged" }, ...(query ? { snapshot: { path: ["title"], string_contains: query } } : {}) };
      include = { release: true };
      if (active && !status) where.status = { notIn: ["merged", "completed", "cancelled"] };
    } else {
      table = client.projectDeliverable;
      where = { ...projects, ...(status ? { status } : {}), ...(scope === "mine" ? { authorId: actorId } : {}),
        ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { body: { contains: query, mode: "insensitive" } }, { issue: { title: { contains: query, mode: "insensitive" } } }] } : {}) };
      include = { issue: { select: { id: true, title: true, number: true, type: true, status: true } } };
    }
    const [total, items] = await Promise.all([
      table.count({ where }),
      table.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit }),
    ]);
    const ids = [...new Set(items.flatMap(item => [item.developerId, item.authorId, item.executorId]).filter(Boolean))];
    const people = await client.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
    return { items, people, total, nextOffset: offset + items.length < total ? offset + items.length : null };
  }
}
module.exports = { WorkbenchStore };
