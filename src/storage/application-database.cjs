const path = require("node:path");
const { createHash } = require("node:crypto");
const { PostgresDatabase } = require("./postgres-database.cjs");
const { unregisterDatabase } = require("./database-registry.cjs");

function missing() { return Object.assign(new Error("工作区不存在。"), { code: "ENOENT", statusCode: 404 }); }
function json(value) { return JSON.parse(JSON.stringify(value)); }
function prefixFilter(prefix) { return { startsWith: prefix.replace(/[\\%_]/g, "\\$&") }; }

class ApplicationDatabase extends PostgresDatabase {
  constructor({ directory, encryptionKey, url }) {
    super(url);
    this.dataRoot = path.resolve(directory);
    this.encryptionKey = encryptionKey;
    if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32)
      throw new Error("数据库凭据主密钥无效。");
  }

  relative(file) {
    const relative = path.relative(this.dataRoot, path.resolve(file));
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error("数据库资源必须位于当前数据目录内。");
    return relative.split(path.sep).join("/");
  }

  scope(relative) {
    const parts = relative.split("/");
    const workspaceId = parts[0] === "workspaces" ? parts[1] : null;
    const runIndex = parts.indexOf("runs", workspaceId ? 2 : 0);
    return { workspaceId, runKey: runIndex >= 0 ? parts[runIndex + 1] || null : null, name: parts.at(-1) };
  }

  workspaceRecord(row) {
    if (!row?.settings) throw missing();
    const config = row.settings.data;
    return { ...config, workspace: { ...config.workspace, id: row.id, name: row.name, icon: row.icon,
      owner_user_id: row.ownerUserId, owner_username: row.owner.username } };
  }

  async readWorkspace(id, ownerUserId) {
    const row = await this.client.workspace.findUnique({ where: { id }, include: { settings: true, owner: true } });
    if (!row || (ownerUserId !== undefined && row.ownerUserId !== ownerUserId)) throw missing();
    return this.workspaceRecord(row);
  }

  async listWorkspaces(ownerUserId) {
    if (!ownerUserId) return [];
    return (await this.client.workspace.findMany({ where: { ownerUserId }, include: { settings: true, owner: true },
      orderBy: [{ name: "asc" }, { id: "asc" }] })).map((row) => this.workspaceRecord(row));
  }

  async writeWorkspace(id, config) {
    return (await this.transaction(async () => {
      const existing = await this.client.workspace.findUnique({ where: { id } });
      const ownerUserId = config.workspace?.owner_user_id;
      if (!ownerUserId || (existing && existing.ownerUserId !== ownerUserId))
        throw new Error("工作区所有者不可缺失或更改。");
      const data = { name: config.workspace.name, icon: config.workspace.icon ?? null };
      await this.client.workspace.upsert({ where: { id }, create: { id, ownerUserId, ...data }, update: data });
      const settings = json(config);
      await this.client.workspaceSetting.upsert({ where: { workspaceId: id },
        create: { workspaceId: id, data: settings }, update: { data: settings } });
      return config;
    }));
  }

  async readDocument(file) {
    const relative = this.relative(file);
    const { workspaceId, runKey, name } = this.scope(relative);
    if (workspaceId && relative === `workspaces/${workspaceId}/config.json`) {
      try { return await this.readWorkspace(workspaceId); }
      catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
    }
    if (relative === "system-settings.json")
      return Object.fromEntries((await this.client.systemSetting.findMany()).map(({ key, value }) => [key, value]));
    const table = runKey ? (name === "run.json" ? this.client.run : this.client.runDocument) : this.client.document;
    return (await table.findUnique({ where: { path: relative } }))?.data;
  }

  async writeDocument(file, value) {
    const relative = this.relative(file);
    const { workspaceId, runKey, name } = this.scope(relative);
    if (workspaceId && relative === `workspaces/${workspaceId}/config.json`) return (await this.writeWorkspace(workspaceId, value));
    if (relative === "system-settings.json") return (await this.transaction(async () => {
      for (const [key, entry] of Object.entries(value))
        await this.client.systemSetting.upsert({ where: { key }, create: { key, value: json(entry) }, update: { value: json(entry) } });
      return value;
    }));
    const data = json(value);
    if (runKey && name === "run.json") {
      const owner = workspaceId ? await this.client.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { ownerUserId: true } }) : null;
      const fields = { sessionId: value.session_id ?? null,
        executionState: value.execution?.status ?? null,
        source: value.source ? json(value.source) : this.jsonNull, data };
      await this.client.run.upsert({ where: { path: relative }, create: {
        path: relative, workspaceId, ownerUserId: owner?.ownerUserId || null, runKey, ...fields,
        ...(value.created_at ? { createdAt: new Date(value.created_at) } : {}),
      }, update: fields });
    } else if (runKey) {
      await this.client.runDocument.upsert({ where: { path: relative }, create: { path: relative, workspaceId, runKey, name, data }, update: { data } });
    } else {
      await this.client.document.upsert({ where: { path: relative }, create: { path: relative, data }, update: { data } });
    }
    return value;
  }

  async updateDocument(file, update, fallback = {}) {
    return (await this.transaction(async () => (await this.writeDocument(file, await update(await this.readDocument(file) ?? fallback)))));
  }

  async deleteDocument(file) {
    const relative = this.relative(file);
    const { runKey, name } = this.scope(relative);
    const table = runKey ? (name === "run.json" ? this.client.run : this.client.runDocument) : this.client.document;
    return (await table.deleteMany({ where: { path: relative } })).count > 0;
  }

  async deleteRunDirectory(directory) {
    const relative = this.relative(directory);
    const prefix = `${relative}/`;
    return (await this.transaction(async () => {
      await this.client.sessionItem.deleteMany({ where: { runPath: relative } });
      for (const table of [this.client.runDocument, this.client.attachment, this.client.logChunk])
        await table.deleteMany({ where: { path: prefixFilter(prefix) } });
      return (await this.client.run.deleteMany({ where: { path: `${relative}/run.json` } })).count > 0;
    }));
  }

  async listDocuments(directory) {
    const prefix = `${this.relative(directory).replace(/\/$/, "")}/`;
    const tables = [this.client.document, this.client.run, this.client.runDocument];
    const rows = await Promise.all(tables.map((table) => table.findMany({ where: { path: prefixFilter(prefix) },
      select: { path: true, data: true }, orderBy: { path: "asc" } })));
    return rows.flat().map((row) => ({ path: path.join(this.dataRoot, row.path), value: row.data }));
  }

  async putBlob(file, data, metadata = {}) {
    if (!Buffer.isBuffer(data)) throw new Error("附件内容必须是 Buffer。");
    const relative = this.relative(file);
    const { workspaceId, runKey } = this.scope(relative);
    const fields = { mimeType: metadata.mimeType || "application/octet-stream", size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"), data,
      metadata: json(metadata), expiresAt: metadata.expiresAt ? new Date(metadata.expiresAt) : null };
    await this.client.attachment.upsert({ where: { path: relative }, create: { path: relative, workspaceId, runKey, ...fields,
      ...(metadata.createdAt ? { createdAt: new Date(metadata.createdAt) } : {}) }, update: fields });
    return (await this.readBlob(file));
  }

  blobRecord(row) {
    return { ...row.metadata, path: path.join(this.dataRoot, row.path), mimeType: row.mimeType, size: row.size,
      sha256: row.sha256, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() || null,
      ...(row.data === undefined ? {} : { data: Buffer.from(row.data) }) };
  }

  async readBlob(file) {
    const row = await this.client.attachment.findUnique({ where: { path: this.relative(file) } });
    return row ? this.blobRecord(row) : undefined;
  }

  async deleteBlob(file) {
    return (await this.client.attachment.deleteMany({ where: { path: this.relative(file) } })).count > 0;
  }

  async listBlobs(directory) {
    const prefix = `${this.relative(directory).replace(/\/$/, "")}/`;
    return (await this.client.attachment.findMany({ where: { path: prefixFilter(prefix) }, orderBy: { path: "asc" },
      omit: { data: true } })).map((row) => this.blobRecord(row));
  }

  async appendLog(file, data) {
    await this.client.logChunk.create({ data: { path: this.relative(file), data: Buffer.isBuffer(data) ? data : Buffer.from(data) } });
  }

  async close() {
    unregisterDatabase(this);
    await super.close();
  }
}

module.exports = { ApplicationDatabase };
