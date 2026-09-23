const path = require("node:path");
const { createHash } = require("node:crypto");
const { encodeSettings, decodeSettings } = require("./database-secrets.cjs");
const { unregisterDatabase } = require("./database-registry.cjs");

function missing() {
  return Object.assign(new Error("工作区不存在。"), { code: "ENOENT", statusCode: 404 });
}

class ApplicationDatabase {
  constructor(dataRoot, handle, encryptionKey) {
    this.dataRoot = path.resolve(dataRoot);
    this.directory = path.join(this.dataRoot, "db");
    this.file = path.join(this.directory, "web-coding.sqlite");
    this.handle = handle;
    this.encryptionKey = encryptionKey;
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
    const runKey = runIndex >= 0 ? parts[runIndex + 1] : null;
    return { workspaceId, runKey: runKey || null, name: parts.at(-1) };
  }

  transaction(operation) {
    return this.handle.transaction(operation).immediate();
  }

  readWorkspace(id, ownerUserId) {
    const row = this.handle.prepare(`SELECT w.*, s.data, u.username AS owner_username FROM workspaces w
      JOIN workspace_settings s ON s.workspace_id=w.id
      JOIN users u ON u.id=w.owner_user_id WHERE w.id=?`).get(id);
    if (!row || (ownerUserId !== undefined && row.owner_user_id !== ownerUserId)) throw missing();
    const config = decodeSettings(row.data, this.encryptionKey);
    return { ...config, workspace: { ...config.workspace, id: row.id, name: row.name,
      icon: row.icon, owner_user_id: row.owner_user_id, owner_username: row.owner_username } };
  }

  listWorkspaces(ownerUserId) {
    if (!ownerUserId) return [];
    return this.handle.prepare("SELECT id FROM workspaces WHERE owner_user_id=? ORDER BY name,id")
      .all(ownerUserId).map(({ id }) => this.readWorkspace(id, ownerUserId));
  }

  writeWorkspace(id, config) {
    const existing = this.handle.prepare("SELECT owner_user_id FROM workspaces WHERE id=?").get(id);
    const owner = config.workspace?.owner_user_id;
    if (!owner || (existing && existing.owner_user_id !== owner))
      throw new Error("工作区所有者不可缺失或更改。");
    const now = new Date().toISOString();
    return this.transaction(() => {
      this.handle.prepare(`INSERT INTO workspaces(id,owner_user_id,name,icon,created_at,updated_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,icon=excluded.icon,updated_at=excluded.updated_at`)
        .run(id, owner, config.workspace.name, config.workspace.icon ?? null, now, now);
      this.handle.prepare(`INSERT INTO workspace_settings(workspace_id,data,updated_at) VALUES(?,?,?)
        ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`)
        .run(id, encodeSettings(config, this.encryptionKey), now);
      return config;
    });
  }

  readDocument(file) {
    const relative = this.relative(file);
    const { workspaceId, runKey, name } = this.scope(relative);
    if (workspaceId && relative === `workspaces/${workspaceId}/config.json`) {
      try { return this.readWorkspace(workspaceId); }
      catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
    }
    if (relative === "system-settings.json") {
      const rows = this.handle.prepare("SELECT key,value FROM system_settings").all();
      return Object.fromEntries(rows.map(({ key, value }) => [key, JSON.parse(value)]));
    }
    const table = runKey ? (name === "run.json" ? "runs" : "run_documents") : "documents";
    const row = this.handle.prepare(`SELECT data FROM ${table} WHERE path=?`).get(relative);
    return row ? JSON.parse(row.data) : undefined;
  }

  writeDocument(file, value) {
    const relative = this.relative(file);
    const { workspaceId, runKey, name } = this.scope(relative);
    if (workspaceId && relative === `workspaces/${workspaceId}/config.json`)
      return this.writeWorkspace(workspaceId, value);
    const now = new Date().toISOString();
    if (relative === "system-settings.json") return this.transaction(() => {
      const statement = this.handle.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`);
      for (const [key, setting] of Object.entries(value)) statement.run(key, JSON.stringify(setting), now);
      return value;
    });
    const serialized = JSON.stringify(value);
    if (runKey && name === "run.json") {
      const owner = workspaceId ? this.handle.prepare("SELECT owner_user_id FROM workspaces WHERE id=?").get(workspaceId)?.owner_user_id : null;
      this.handle.prepare(`INSERT INTO runs(path,workspace_id,owner_user_id,run_key,session_id,execution_state,source_json,data,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET
        session_id=excluded.session_id,execution_state=excluded.execution_state,source_json=excluded.source_json,data=excluded.data,updated_at=excluded.updated_at`)
        .run(relative, workspaceId, owner || null, runKey, value.session_id ?? value.session?.id ?? null,
          typeof value.execution === "string" ? value.execution : value.execution?.status ?? value.status ?? null,
          JSON.stringify(value.source ?? null), serialized, value.created_at || now, now);
    } else if (runKey) {
      this.handle.prepare(`INSERT INTO run_documents(path,workspace_id,run_key,name,data,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(path) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`)
        .run(relative, workspaceId, runKey, name, serialized, now);
    } else {
      this.handle.prepare(`INSERT INTO documents(path,data,updated_at) VALUES(?,?,?)
        ON CONFLICT(path) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`).run(relative, serialized, now);
    }
    return value;
  }

  updateDocument(file, update, fallback = {}) {
    return this.transaction(() => this.writeDocument(file, update(this.readDocument(file) ?? fallback)));
  }

  deleteDocument(file) {
    const relative = this.relative(file);
    const { runKey, name } = this.scope(relative);
    const table = runKey ? (name === "run.json" ? "runs" : "run_documents") : "documents";
    return this.handle.prepare(`DELETE FROM ${table} WHERE path=?`).run(relative).changes > 0;
  }

  deleteRunDirectory(directory) {
    const relative = this.relative(directory);
    const prefix = `${relative}/`;
    return this.transaction(() => {
      this.handle.prepare("DELETE FROM session_items WHERE run_path=?").run(relative);
      for (const table of ["run_documents", "attachments", "log_chunks"])
        this.handle.prepare(`DELETE FROM ${table} WHERE substr(path,1,?)=?`)
          .run(prefix.length, prefix);
      return this.handle.prepare("DELETE FROM runs WHERE path=?")
        .run(`${relative}/run.json`).changes > 0;
    });
  }

  listDocuments(directory) {
    const prefix = `${this.relative(directory).replace(/\/$/, "")}/`;
    return ["documents", "runs", "run_documents"].flatMap((table) =>
      this.handle.prepare(`SELECT path,data FROM ${table} WHERE substr(path,1,?)=? ORDER BY path`)
        .all(prefix.length, prefix).map((row) => ({ path: path.join(this.dataRoot, row.path), value: JSON.parse(row.data) })));
  }

  putBlob(file, data, metadata = {}) {
    if (!Buffer.isBuffer(data)) throw new Error("附件内容必须是 Buffer。");
    const relative = this.relative(file);
    const { workspaceId, runKey } = this.scope(relative);
    const hash = createHash("sha256").update(data).digest("hex");
    const now = new Date().toISOString();
    this.handle.prepare(`INSERT INTO attachments(path,workspace_id,run_key,mime_type,size,sha256,data,metadata_json,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET
      mime_type=excluded.mime_type,size=excluded.size,sha256=excluded.sha256,data=excluded.data,metadata_json=excluded.metadata_json,expires_at=excluded.expires_at`)
      .run(relative, workspaceId, runKey, metadata.mimeType || "application/octet-stream", data.length, hash, data,
        JSON.stringify(metadata), metadata.createdAt || now, metadata.expiresAt || null);
    return this.readBlob(file);
  }

  readBlob(file) {
    const row = this.handle.prepare("SELECT * FROM attachments WHERE path=?").get(this.relative(file));
    if (!row) return undefined;
    return { ...JSON.parse(row.metadata_json), path: file, data: row.data, mimeType: row.mime_type,
      size: row.size, sha256: row.sha256, createdAt: row.created_at, expiresAt: row.expires_at };
  }

  deleteBlob(file) {
    return this.handle.prepare("DELETE FROM attachments WHERE path=?").run(this.relative(file)).changes > 0;
  }

  listBlobs(directory) {
    const prefix = `${this.relative(directory).replace(/\/$/, "")}/`;
    return this.handle.prepare("SELECT path,mime_type,size,sha256,metadata_json,created_at,expires_at FROM attachments WHERE substr(path,1,?)=? ORDER BY path")
      .all(prefix.length, prefix).map((row) => ({ ...JSON.parse(row.metadata_json),
        path: path.join(this.dataRoot, row.path), mimeType: row.mime_type, size: row.size,
        sha256: row.sha256, createdAt: row.created_at, expiresAt: row.expires_at }));
  }

  close() {
    unregisterDatabase(this);
    if (this.handle.open) this.handle.close();
    this.onClose?.();
    this.onClose = undefined;
  }
}

module.exports = { ApplicationDatabase };
