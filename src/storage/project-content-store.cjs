const { previewMimeType } = require("../domain/project-files.cjs");
const { createHash } = require("node:crypto");
const { accountError } = require("../domain/account.cjs");
const { encodeSecret, decodeSecret } = require("./database-secrets.cjs");

function missing() { return accountError("项目资料不存在。", 404); }
function serializable(value) { return JSON.parse(JSON.stringify(value)); }
function conflict() { return accountError("资料已被其他人修改，请刷新后重试。", 409); }
const fileMetadata = { id: true, projectId: true, issueId: true, assetId: true, authorId: true, name: true, mimeType: true, size: true, sha256: true, createdAt: true };

class ProjectContentStore {
  constructor(database) { this.database = database; }
  async transaction(operation) {
    try { return await this.database.transaction(operation); }
    catch (error) { if (["P2034", "P2002"].includes(error.code)) throw conflict(); throw error; }
  }
  async members(projectId, ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return;
    const count = await this.database.client.projectMember.count({ where: { projectId, userId: { in: unique }, status: "active", user: { status: "active" } } });
    if (count !== unique.length) throw accountError("负责人和参与人必须是有效项目成员。", 400);
  }
  async people(ids) {
    return this.database.client.user.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean))] } }, select: { id: true, username: true } });
  }
  async issue(projectId, id) {
    const value = await this.database.client.projectIssue.findFirst({ where: { projectId, id }, include: { source: true } });
    if (!value) throw missing();
    return value;
  }
  async issues(projectId, { type, status, query, limit, offset }) {
    const where = { projectId, ...(type ? { type } : {}), ...(status ? { status } : {}),
      ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] } : {}) };
    const rows = await this.database.client.projectIssue.findMany({ where, orderBy: [{ number: "desc" }], skip: offset, take: limit + 1, include: { source: true } });
    return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }
  async createIssue(projectId, actorId, data, source, { requestId, attachments = [] } = {}) {
    const creationRequestHash = requestId ? createHash("sha256").update(JSON.stringify({ data,
      attachments: attachments.map(({ id, name, mimeType, data: bytes }) => ({ id, name, mimeType, size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex") })).sort((left, right) => left.id.localeCompare(right.id)),
    })).digest("hex") : null;
    if (requestId) {
      const existing = await this.database.client.projectIssue.findUnique({ where: { id: requestId } });
      if (existing) {
        if (existing.projectId !== projectId || existing.createdById !== actorId) throw conflict();
        const history = await this.database.client.issueHistory.findFirst({ where: { projectId, issueId: requestId, actorId, action: "created" } });
        if (history?.data?.creationRequestHash !== creationRequestHash) throw conflict();
        return this.issue(projectId, requestId);
      }
    }
    const project = await this.database.client.project.update({ where: { id: projectId }, data: { issueSequence: { increment: 1 } }, select: { issueSequence: true } });
    const issue = await this.database.client.projectIssue.create({ data: { ...data, ...(requestId ? { id: requestId } : {}), projectId, number: project.issueSequence, createdById: actorId, updatedById: actorId } });
    if (source) await this.database.client.issueSource.create({ data: { ...source, projectId, issueId: issue.id } });
    await this.issueHistory(projectId, issue.id, actorId, "created", { after: issue, ...(creationRequestHash ? { creationRequestHash } : {}) });
    return this.issue(projectId, issue.id);
  }
  async updateIssue(projectId, id, actorId, revision, data, action = "updated", extra = {}) {
    const before = await this.issue(projectId, id);
    const updated = await this.database.client.projectIssue.updateMany({ where: { id, projectId, revision }, data: { ...data, updatedById: actorId, revision: { increment: 1 } } });
    if (!updated.count) throw conflict();
    const after = await this.issue(projectId, id);
    await this.issueHistory(projectId, id, actorId, action, { before, after, ...extra });
    return after;
  }
  async issueHistory(projectId, issueId, actorId, action, data) {
    return this.database.client.issueHistory.create({ data: { projectId, issueId, actorId, action, data: serializable(data) } });
  }
  async source(projectId, scope, type, externalId) {
    return this.database.client.issueSource.findUnique({ where: { projectId_channel_scope_type_externalId: { projectId, channel: "tapd", scope, type, externalId } }, include: { issue: { include: { source: true } } } });
  }
  async childList(kind, projectId, issueId, { limit, offset }) {
    await this.issue(projectId, issueId);
    const table = { comments: this.database.client.issueComment, deliverables: this.database.client.issueDeliverable, history: this.database.client.issueHistory }[kind];
    if (!table) throw missing();
    const rows = await table.findMany({ where: { projectId, issueId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit + 1 });
    return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }
  async comment(projectId, issueId, authorId, body) {
    await this.issue(projectId, issueId);
    return this.database.client.issueComment.create({ data: { projectId, issueId, authorId, body } });
  }
  async deliverable(projectId, issueId, authorId, data) {
    await this.issue(projectId, issueId);
    if (data.taskId && !await this.database.client.developmentTask.findFirst({ where: { projectId, id: data.taskId } }))
      throw accountError("开发任务不属于当前项目。", 400);
    return this.database.client.issueDeliverable.create({ data: { projectId, issueId, authorId, ...data } });
  }
  async asset(projectId, id) {
    const row = await this.database.client.projectAsset.findFirst({ where: { projectId, id }, include: { issueLinks: { select: { issueId: true } } } });
    if (!row) throw missing();
    return row;
  }
  async assets(projectId, { type, query, limit, offset }) {
    const rows = await this.database.client.projectAsset.findMany({ where: { projectId, ...(type ? { type } : {}),
      ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { content: { contains: query, mode: "insensitive" } }, { category: { contains: query, mode: "insensitive" } }, { tags: { has: query } }] } : {}) },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: offset, take: limit + 1, include: { issueLinks: { select: { issueId: true } } } });
    return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }
  async linkIssues(projectId, assetId, issueIds) {
    if (await this.database.client.projectIssue.count({ where: { projectId, id: { in: issueIds } } }) !== issueIds.length)
      throw accountError("关联事项不属于当前项目。", 400);
    await this.database.client.assetIssueLink.deleteMany({ where: { projectId, assetId } });
    if (issueIds.length) await this.database.client.assetIssueLink.createMany({ data: issueIds.map(issueId => ({ projectId, assetId, issueId })) });
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
    const row = await this.database.client.projectFile.findFirst({ where: { projectId, id }, ...(withData ? {} : { select: fileMetadata }) });
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
