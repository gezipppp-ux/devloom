class WorkbenchStore {
  constructor(database) { this.database = database; }
  async list(kind, projectIds, actorId, { limit, offset, query, scope, type, priority, status, tag, active }) {
    const client = this.database.client;
    const projects = { projectId: { in: projectIds } };
    let table, where, include;
    if (kind === "issues") {
      table = client.projectIssue;
      where = { ...projects, ...(type ? { type } : {}), ...(priority ? { priority } : {}), ...(status ? { status } : {}), ...(tag ? { tags: { has: tag } } : {}),
        AND: [
          ...(scope === "mine" ? [{ OR: [{ assigneeId: actorId }, { createdById: actorId }, { participantIds: { has: actorId } }] }] : []),
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
      table = client.issueDeliverable;
      where = { ...projects, ...(status ? { status } : {}), ...(scope === "mine" ? { authorId: actorId } : {}),
        ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { body: { contains: query, mode: "insensitive" } }, { issue: { title: { contains: query, mode: "insensitive" } } }] } : {}) };
      include = { issue: { select: { id: true, title: true, number: true, type: true, status: true } } };
    }
    const [total, items] = await Promise.all([
      table.count({ where }),
      table.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit }),
    ]);
    const ids = [...new Set(items.flatMap(item => [item.assigneeId, item.authorId, item.executorId]).filter(Boolean))];
    const people = await client.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
    return { items, people, total, nextOffset: offset + items.length < total ? offset + items.length : null };
  }
}
module.exports = { WorkbenchStore };
