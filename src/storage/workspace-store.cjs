const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  WORKSPACE_ID,
  validateWorkspaceId,
  validateWorkspaceInput,
} = require("../domain/workspace.cjs");
const { readOptional, writeConfig, updateConfig } = require("./json-files.cjs");
const { withAsyncFileLock } = require("./file-lock.cjs");
const { databaseForPath } = require("./database-registry.cjs");

class WorkspaceStore {
  constructor(directory, database = databaseForPath(directory)) {
    this.directory = path.resolve(directory);
    this.database = database;
  }

  paths(id) {
    const directory = path.join(this.directory, validateWorkspaceId(id));
    return {
      configFile: path.join(directory, "config.json"),
      uploadDirectory: path.join(directory, "uploads"),
      runsDirectory: path.join(directory, "runs"),
    };
  }

  configFile(id) {
    return this.paths(id).configFile;
  }

  async read(id, ownerUserId) {
    validateWorkspaceId(id);
    if (this.database) return (await this.database.readWorkspace(id, ownerUserId));
    const config = (await readOptional(this.configFile(id)));
    if (config.workspace?.id !== id)
      throw Object.assign(new Error("工作区不存在。"), { code: "ENOENT" });
    return config;
  }

  async list(ownerUserId) {
    if (this.database) return (await this.database.listWorkspaces(ownerUserId));
    if (!fs.existsSync(this.directory)) return [];
    return (await Promise.all(fs.readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && WORKSPACE_ID.test(entry.name))
      .map(async (entry) => (await this.read(entry.name)))));
  }

  async save(input, id, createConfig, ownerUserId) {
    const workspace = validateWorkspaceInput(input);
    if (this.database) {
      if (!ownerUserId) throw new Error("创建或更新工作区必须指定账号。");
      if (id !== undefined) validateWorkspaceId(id);
      try {
        return (await this.database.transaction(async () => {
          const current = id === undefined ? null : (await this.read(id, ownerUserId));
          if ((await this.list(ownerUserId)).some((entry) => entry.workspace.id !== id && entry.workspace.name === workspace.name))
            throw new Error("工作区名称已存在。");
          const key = id ?? randomUUID();
          const config = current || (await createConfig(key));
          (await this.database.writeWorkspace(key, { ...config,
            workspace: { ...config.workspace, ...workspace, id: key, owner_user_id: ownerUserId } }));
          return (await this.read(key, ownerUserId));
        }));
      } catch (error) {
        if (["P2002", "P2034"].includes(error.code)) throw new Error("工作区名称已存在。");
        throw error;
      }
    }
    // Names are unique across the catalog, not just within one config file.
    return (await withAsyncFileLock(path.join(this.directory, ".catalog"), async () => {
      if (id !== undefined) (await this.read(id));
      if ((await this.list()).some((config) =>
        config.workspace.id !== id && config.workspace.name === workspace.name))
        throw new Error("工作区名称已存在。");
      const key = id ?? randomUUID();
      const file = this.configFile(key);
      const setWorkspace = (config) => ({
        ...config,
        workspace: { ...config.workspace, id: key, ...workspace },
      });
      if (id !== undefined) (await updateConfig(file, setWorkspace));
      else (await writeConfig(file, setWorkspace((await createConfig(key)))));
      return (await this.read(key));
    }, "Workspace catalog"));
  }
}

module.exports = { WorkspaceStore };
