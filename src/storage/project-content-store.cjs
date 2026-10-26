const { SystemWorkflowStore } = require("./system-workflow-store.cjs");
const { workListWhere } = require("./work-list-where.cjs");
const { WorkActionStore } = require("./work-action-store.cjs");
const { ProjectLifecycleStore } = require("./project-lifecycle-store.cjs");
const { assertIssueWritable } = require("../domain/issue-workflows.cjs");
const { previewMimeType } = require("../domain/project-files.cjs");
const { createHash } = require("node:crypto");
const { accountError } = require("../domain/account.cjs");
const { encodeSecret, decodeSecret } = require("./database-secrets.cjs");

function missing() { return accountError("项目资料不存在。", 404); }
function serializable(value) { return JSON.parse(JSON.stringify(value)); }
function conflict() { return accountError("资料已被其他人修改，请刷新后重试。", 409); }
function hashCreationRequest(data, attachments) {
  return createHash("sha256").update(JSON.stringify({ data,
    attachments: attachments.map(({ id, name, mimeType, data: bytes }) => ({ id, name, mimeType, size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") })).sort((left, right) => left.id.localeCompare(right.id)),
  })).digest("hex");
}
const fileMetadata = { id: true, projectId: true, issueId: true, assetId: true, authorId: true, name: true, mimeType: true, size: true, sha256: true, createdAt: true };

const issueRelations = { _count: { select: { taskLinks: true, deliverables: true } }, actions: { where: { status: { in: ["ready", "active"] } } }, deliverables: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, revision: true, authorId: true, reviewerId: true, status: true, actionId: true } }, source: true, release: true, workflowVersion: { include: { workflow: { select: { publishedVersion: true } } } }, developmentClaim: { select: { task: { select: { id: true, status: true, executorId: true, executor: { select: { displayName: true } } } } } } };

class ProjectContentStore {
  constructor(database) { this.database = database; }
  async transaction(operation) {
    try { return await this.database.transaction(operation); }
    catch (error) { if (["P2034", "P2002"].includes(error.code)) throw conflict(); throw error; }
  }
  async members(projectId, ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return;
    const count = await this.database.client.user.count({ where: { id: { in: unique }, status: "active", OR: [{ role: "admin" }, { projectMemberships: { some: { projectId, status: "active" } } }] } });
    if (count !== unique.length) throw accountError("负责人和关注人必须是有效项目成员。", 400);
  }
  async people(ids) {
    return this.database.client.user.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean))] } }, select: { id: true, username: true, displayName: true } });
  }
  async memberCandidates(projectId) {
    return this.database.client.user.findMany({ where: { status: "active", OR: [{ role: "admin" }, { projectMemberships: { some: { projectId, status: "active" } } }] }, select: { id: true, displayName: true, username: true } });
  }
  async issue(projectId, id) {
    const value = await this.database.client.projectIssue.findFirst({ where: { projectId, id, deletedAt: null }, include: issueRelations });
    if (!value) throw missing();
    return value;
  }
  async issues(projectId, { type, status, releaseId, includeArchived, query, limit, offset, filters }) {
    const where = { projectId, deletedAt: null, ...(releaseId !== undefined ? { releaseId } : {}), ...(!includeArchived ? { OR: [{ releaseId: null }, { release: { status: "active" } }] } : {}), ...(type ? { type } : {}), ...(status ? { status } : {}),
      ...(query ? { AND: [{ OR: [{ title: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] }] } : {}) };
    where.AND = [...(where.AND || []), ...workListWhere("issues", filters)];
    const [rows, total] = await Promise.all([this.database.client.projectIssue.findMany({ where, orderBy: [{ number: "desc" }], skip: offset, take: limit + 1, include: issueRelations }), this.database.client.projectIssue.count({ where })]);
    return { items: rows.slice(0, limit), total, nextOffset: rows.length > limit ? offset + limit : null };
  }
  async createIssue(projectId, actorId, data, { requestId, attachments = [] } = {}) {
    const creationRequestHash = requestId ? hashCreationRequest(data, attachments) : null;
    if (requestId) {
      const existing = await this.database.client.projectIssue.findUnique({ where: { id: requestId } });
      if (existing) {
        if (existing.projectId !== projectId || existing.createdById !== actorId) throw conflict();
        if (existing.deletedAt) throw accountError("事项已删除，不能使用原创建标识重新发布。", 409);
        const history = await this.database.client.issueHistory.findFirst({ where: { projectId, issueId: requestId, actorId, action: "created" } });
        const storedHash = history?.data?.creationRequestHash;
        if (storedHash !== creationRequestHash) throw conflict();
        return this.issue(projectId, requestId);
      }
    }
    const lifecycle = new ProjectLifecycleStore(this.database);
    await lifecycle.writableRelease(projectId, data.releaseId);
    const workflow = await new SystemWorkflowStore(this.database).workflow(data.type);
    const version = workflow.versions.find(row => row.version === workflow.publishedVersion);
    data = { ...data, workflowVersionId: version.id, status: version.definition.nodes.find(node => node.kind === "initial").id };
    const project = await this.database.client.project.update({ where: { id: projectId }, data: { issueSequence: { increment: 1 } }, select: { issueSequence: true } });
    const issue = await this.database.client.projectIssue.create({ data: { ...data, ...(requestId ? { id: requestId } : {}), projectId, number: project.issueSequence, createdById: actorId, updatedById: actorId } });
    await new WorkActionStore(this.database).syncIssue({ ...issue, workflowVersion: version }, { initial: true });
    await this.issueHistory(projectId, issue.id, actorId, "created", { after: issue, ...(creationRequestHash ? { creationRequestHash } : {}) });
    return this.issue(projectId, issue.id);
  }
  async updateIssue(projectId, id, actorId, revision, data, action = "updated", extra = {}) {
    const before = await this.issue(projectId, id);
    assertIssueWritable(before);
    if (Object.hasOwn(data, "releaseId")) {
      await new ProjectLifecycleStore(this.database).writableRelease(projectId, data.releaseId);
      if (data.releaseId !== before.releaseId && await this.database.client.issueDevelopmentClaim.count({ where: { projectId, issueId: id } })) throw accountError("事项有未结束开发任务，不能变更版本。", 409);
    }
    const updated = await this.database.client.projectIssue.updateMany({ where: { id, projectId, revision, deletedAt: null }, data: { ...data, updatedById: actorId, revision: { increment: 1 } } });
    if (!updated.count) throw conflict();
    await new WorkActionStore(this.database).syncIssue(await this.issue(projectId, id), { handlerId: extra.handlerId, explicitHandler: extra.explicitHandler });
    const after = await this.issue(projectId, id);
    await this.issueHistory(projectId, id, actorId, action, { before, after, ...extra });
    return after;
  }
  async issueHistory(projectId, issueId, actorId, action, data) {
    return this.database.client.issueHistory.create({ data: { projectId, issueId, actorId, action, data: serializable(data) } });
  }
  async developmentAssignment(issue) {
    const schema = this.database.schema.replace(/"/g, '""');
    // Revisions order changes even when several records have the same timestamp.
    // Read only public assignment metadata, never the stored before/after documents.
    const rows = await this.database.client.$queryRawUnsafe(
      `SELECT actor_id AS "actorId", data #>> '{after,developerId}' AS "developerId", created_at AS "createdAt"
       FROM "${schema}".issue_history
       WHERE project_id = $1 AND issue_id = $2 AND action = 'assigned'
         AND (data #>> '{after,revision}')::integer <= $3
       ORDER BY (data #>> '{after,revision}')::integer DESC, created_at DESC, id DESC LIMIT 1`,
      issue.projectId, issue.id, issue.revision);
    return rows[0] || null;
  }
  async deleteIssue(projectId, id, actorId, revision) {
    const deletedAt = new Date();
    const updated = await this.database.client.projectIssue.updateMany({
      where: { projectId, id, revision, deletedAt: null, taskLinks: { none: {} }, deliverables: { none: {} }, developmentClaim: { is: null } },
      data: { deletedAt, updatedById: actorId, revision: { increment: 1 } },
    });
    if (!updated.count) throw conflict();
    await this.database.client.workAction.updateMany({ where: { projectId, issueId: id, status: { in: ["ready", "active"] } },
      data: { status: "cancelled", endedAt: deletedAt, revision: { increment: 1 } } });
    await this.issueHistory(projectId, id, actorId, "deleted", { revision, deletedAt });
    await this.audit(actorId, "issue.deleted", projectId, id);
  }
  async childList(kind, projectId, issueId, { limit, offset }) {
    await this.issue(projectId, issueId);
    const table = { comments: this.database.client.issueComment, deliverables: this.database.client.projectDeliverable, history: this.database.client.issueHistory }[kind];
    if (!table) throw missing();
    const rows = await table.findMany({ where: { projectId, issueId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit + 1 });
    return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }
  async comment(projectId, issueId, authorId, body) {
    assertIssueWritable(await this.issue(projectId, issueId));
    return this.database.client.issueComment.create({ data: { projectId, issueId, authorId, body } });
  }
  async deliveryTask(projectId, issueId, authorId, data) {
    if (data.taskId) {
      const task = await this.database.client.developmentTask.findFirst({ where: { projectId, id: data.taskId, executorId: authorId }, include: { release: true, issueLinks: true, workflowEvents: true } });
      const eligible = ["started", "completed", ...(data.supersedesId ? ["cancelled"] : [])];
      const unstarted = issueId && task?.status === "planned" && !task.runKey && !task.workspaceId && !task.snapshot.startRequest && !task.snapshot.workflowIntent && !task.workflowEvents.length;
      if (!task || !unstarted && (!task.runKey || !eligible.includes(task.status))) throw accountError("只能发布本人当前待开发任务或已结束执行的成果。", 400);
      if (task.release?.status === "archived") throw accountError("已归档版本不能发布交付。", 409);
      if (issueId ? !task.issueLinks.some(link => link.issueId === issueId) : task.snapshot.kind !== "manual") throw accountError("交付来源与开发任务范围不一致。", 400);
      return task;
    }
    return null;
  }
  async workflowSwitchState(projectId, issueId) {
    const deliveries = await this.database.client.projectDeliverable.count({ where: { projectId, issueId } });
    const tasks = await this.database.client.developmentTask.findMany({ where: { projectId, issueLinks: { some: { issueId } } }, include: { workflowEvents: true } });
    return { deliveries, tasks };
  }
  async workflowSwitchRequest(projectId, issueId, actorId, requestId) {
    return this.database.client.issueHistory.findFirst({ where: { projectId, issueId, actorId, action: "workflow.upgraded", data: { path: ["requestId"], equals: requestId } } });
  }
  async deliverable(projectId, issueId, authorId, data) {
    if (issueId) assertIssueWritable(await this.issue(projectId, issueId));
    await this.deliveryTask(projectId, issueId, authorId, data);
    return this.database.client.projectDeliverable.create({ data: { projectId, issueId, authorId, ...data } });
  }
  async readDeliverable(projectId, id) {
    const row = await this.database.client.projectDeliverable.findFirst({ where: { projectId, id }, include: { next: { select: { id: true } } } });
    if (!row) throw missing();
    return row;
  }
  async beginDelivery(projectId, id, actorId, revision) {
    const changed = await this.database.client.projectDeliverable.updateMany({ where: { projectId, id, reviewerId: actorId, revision, status: "pending", verificationStartedAt: null }, data: { verificationStartedAt: new Date(), revision: { increment: 1 } } });
    if (!changed.count) throw conflict();
    await this.audit(actorId, "delivery.verification.started", projectId, id);
    return this.readDeliverable(projectId, id);
  }
  async reassignDelivery(projectId, id, actorId, revision, reviewerId) {
    const before = await this.readDeliverable(projectId, id);
    const changed = await this.database.client.projectDeliverable.updateMany({ where: { projectId, id, revision, status: "pending" }, data: { reviewerId, revision: { increment: 1 } } });
    if (!changed.count) throw conflict();
    if (before.issueId) await this.issueHistory(projectId, before.issueId, actorId, "delivery.reassigned", { deliveryId: id, beforeReviewerId: before.reviewerId, reviewerId });
    await this.audit(actorId, "delivery.reassigned", projectId, id);
    return this.readDeliverable(projectId, id);
  }
  async latestDelivery(projectId, issueId) {
    return this.database.client.projectDeliverable.findFirst({ where: { projectId, issueId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  }
  async deliveryRequest(requestId) { return requestId ? this.database.client.projectDeliverable.findUnique({ where: { requestId } }) : null; }
  async bindDeliveryAction(id, actionId) { return this.database.client.projectDeliverable.update({ where: { id }, data: { actionId } }); }
  async hasAcceptedDelivery(projectId, issueId) {
    const latest = await this.database.client.projectDeliverable.findFirst({ where: { projectId, issueId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { status: true } });
    return latest?.status === "accepted";
  }
  async reviewDeliverable(projectId, id, actorId, revision, input) {
    const before = await this.readDeliverable(projectId, id);
    if (before.issueId) assertIssueWritable(await this.issue(projectId, before.issueId));
    const updated = await this.database.client.projectDeliverable.updateMany({ where: { projectId, id, revision, status: "pending" },
      data: { ...input, reviewedById: actorId, reviewedAt: new Date(), revision: { increment: 1 } } });
    if (!updated.count) throw conflict();
    if (before.issueId) await this.issueHistory(projectId, before.issueId, actorId, "delivery.reviewed", { deliveryId: id, ...input });
    await this.audit(actorId, "delivery.reviewed", projectId, id);
    return this.readDeliverable(projectId, id);
  }
  async asset(projectId, id) {
    const row = await this.database.client.projectAsset.findFirst({ where: { projectId, id }, include: { issueLinks: { where: { issue: { deletedAt: null } }, select: { issueId: true } } } });
    if (!row) throw missing();
    return row;
  }
  async assets(projectId, { type, query, limit, offset }) {
    const rows = await this.database.client.projectAsset.findMany({ where: { projectId, ...(type ? { type } : {}),
      ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { content: { contains: query, mode: "insensitive" } }, { category: { contains: query, mode: "insensitive" } }, { tags: { has: query } }] } : {}) },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: offset, take: limit + 1, include: { issueLinks: { where: { issue: { deletedAt: null } }, select: { issueId: true } } } });
    return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }
  async linkIssues(projectId, assetId, issueIds) {
    if (await this.database.client.projectIssue.count({ where: { projectId, deletedAt: null, id: { in: issueIds } } }) !== issueIds.length)
      throw accountError("关联事项不属于当前项目。", 400);
    const existing = await this.database.client.assetIssueLink.findMany({ where: { projectId, assetId, issue: { deletedAt: null } } });
    const before = new Set(existing.map(link => link.issueId));
    const after = new Set(issueIds);
    const changed = [...new Set([...before, ...after])].filter(id => before.has(id) !== after.has(id));
    for (const issueId of changed) assertIssueWritable(await this.issue(projectId, issueId));
    await this.database.client.assetIssueLink.deleteMany({ where: { projectId, assetId, issue: { deletedAt: null }, issueId: { notIn: issueIds } } });
    const added = issueIds.filter(issueId => !before.has(issueId));
    if (added.length) await this.database.client.assetIssueLink.createMany({ data: added.map(issueId => ({ projectId, assetId, issueId })) });
  }
  async saveAsset(projectId, actorId, input, current) {
    const { secret, issueIds, ...fields } = input;
    const data = { ...fields, ...(Object.hasOwn(input, "secret") ? { secret: secret === null ? null : encodeSecret({ value: secret }, this.database.encryptionKey) } : {}) };
    let id = current?.id;
    if (current) {
      const updated = await this.database.client.projectAsset.updateMany({ where: { projectId, id, revision: current.revision }, data: { ...data, updatedById: actorId, revision: { increment: 1 } } });
      if (!updated.count) throw conflict();
    } else {
      id = (await this.database.client.projectAsset.create({ data: { ...data, projectId, createdById: actorId, updatedById: actorId } })).id;
    }
    if (issueIds !== undefined) await this.linkIssues(projectId, id, issueIds);
    const row = await this.asset(projectId, id);
    const { secret: encrypted, issueLinks, ...snapshot } = row;
    await this.database.client.assetHistory.create({ data: { projectId, assetId: id, actorId, revision: row.revision,
      data: serializable({ ...snapshot, issueIds: issueLinks.map(link => link.issueId), hasSecret: Boolean(encrypted) }), secret: encrypted } });
    return row;
  }
  async assetHistory(projectId, assetId, { limit, offset }) {
    await this.asset(projectId, assetId);
    const rows = await this.database.client.assetHistory.findMany({ where: { projectId, assetId }, orderBy: { revision: "desc" }, skip: offset, take: limit + 1,
      select: { id: true, projectId: true, assetId: true, actorId: true, revision: true, data: true, createdAt: true } });
    return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }
  async secret(projectId, id) {
    const asset = await this.asset(projectId, id);
    return asset.secret ? decodeSecret(asset.secret, this.database.encryptionKey).value : null;
  }
  async audit(actorId, event, projectId, resourceId) {
    await this.database.client.auditEvent.create({ data: { actorUserId: actorId, event, details: { projectId, resourceId } } });
  }
  async file(projectId, id, withData = false) {
    const row = await this.database.client.projectFile.findFirst({ where: { projectId, id, OR: [{ issueId: null }, { issue: { deletedAt: null } }] }, ...(withData ? {} : { select: fileMetadata }) });
    if (!row) throw missing();
    return withData ? { ...row, data: Buffer.from(row.data) } : row;
  }
  async files(projectId, resource, id, { limit, offset }) {
    const rows = await this.database.client.projectFile.findMany({ where: { projectId, [resource === "issues" ? "issueId" : "assetId"]: id },
      select: fileMetadata, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit + 1 });
    return { items: await this.filePreviews(projectId, rows.slice(0, limit)), nextOffset: rows.length > limit ? offset + limit : null };
  }
  async filePreviews(projectId, rows) {
    if (!rows.length) return [];
    // Read only signatures, not up to 100 complete attachment BLOBs for a list.
    const schema = this.database.schema.replace(/"/g, '""');
    const prefixes = await this.database.client.$queryRawUnsafe(
      `SELECT id, substring(data from 1 for 12) AS prefix FROM "${schema}".project_files WHERE project_id = $1 AND id = ANY($2::text[])`,
      projectId, rows.map(row => row.id));
    const types = new Map(prefixes.map(row => [row.id, previewMimeType(row.prefix)]));
    return rows.map(row => ({ ...row, previewMimeType: types.get(row.id) || null }));
  }
  async issuePreviewFiles(projectId, issueId) {
    const rows = await this.database.client.projectFile.findMany({ where: { projectId, issueId, assetId: null }, select: fileMetadata });
    return (await this.filePreviews(projectId, rows)).filter(row => row.previewMimeType);
  }
  async addFile(projectId, resource, id, authorId, { id: fileId, name, mimeType, data }) {
    if (resource === "issues") assertIssueWritable(await this.issue(projectId, id));
    const sha256 = createHash("sha256").update(data).digest("hex");
    if (fileId) {
      const existing = await this.database.client.projectFile.findUnique({ where: { id: fileId }, select: fileMetadata });
      if (existing) {
        if (existing.projectId !== projectId || existing.authorId !== authorId ||
            existing.issueId !== (resource === "issues" ? id : null) || existing.assetId !== (resource === "assets" ? id : null) ||
            existing.name !== name || existing.mimeType !== mimeType || existing.size !== data.length || existing.sha256 !== sha256) throw conflict();
        return { ...existing, previewMimeType: previewMimeType(data) };
      }
    }
    const row = await this.database.client.projectFile.create({ data: { ...(fileId ? { id: fileId } : {}), projectId, [resource === "issues" ? "issueId" : "assetId"]: id, authorId, name, mimeType,
      data, size: data.length, sha256 }, select: fileMetadata });
    return { ...row, previewMimeType: previewMimeType(data) };
  }
}

module.exports = { ProjectContentStore };
