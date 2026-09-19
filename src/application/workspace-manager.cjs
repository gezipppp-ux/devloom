const path = require("node:path");
const { dataRoot } = require("../config/runtime.cjs");
const { WorkspaceStore } = require("../storage/workspace-store.cjs");
const {
  defaultChannels,
  defaultChannelConfig,
} = require("../channels/channel-registry.cjs");
const { SessionManager } = require("./session-manager.cjs");
const { defaultWorktreeDirectory } = require("../domain/worktree-directory.cjs");

function presentWorkspace(config) {
  return {
    id: config.workspace.id,
    name: config.workspace.name,
    icon: config.workspace.icon ?? null,
  };
}

// Composes workspace configuration and owns each workspace's session lifecycle.
class WorkspaceManager {
  constructor({
    directory = path.join(dataRoot, "workspaces"),
    database,
    createManager = (options) => new SessionManager(options),
  } = {}) {
    this.store = new WorkspaceStore(directory, database);
    this.directory = this.store.directory;
    this.createManager = createManager;
    this.contexts = new Map();
  }

  configFile(id) {
    return this.store.configFile(id);
  }

  owner(actor) {
    if (this.store.database && (!actor?.id || actor.status === "disabled"))
      throw Object.assign(new Error("请先登录。"), { statusCode: 401 });
    return actor?.id;
  }

  read(id, actor) {
    return presentWorkspace(this.store.read(id, this.owner(actor)));
  }

  list(actor) {
    return this.store.list(this.owner(actor))
      .map(presentWorkspace)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  save(input, id, actor) {
    const owner = this.owner(actor);
    return presentWorkspace(this.store.save(input, id, (key) => ({
      version: 3,
      codex: { worktree_directory: defaultWorktreeDirectory(key) },
      ...defaultChannelConfig(),
    }), owner));
  }

  get(id, actor) {
    this.read(id, actor);
    if (!this.contexts.has(id)) {
      const { configFile, uploadDirectory, runsDirectory } = this.store.paths(id);
      const channels = defaultChannels(configFile, { uploadDirectory });
      const sessions = this.createManager({
        configFile,
        channels,
        runsDirectory,
        apiPrefix: `/api/workspaces/${id}`,
      });
      this.contexts.set(id, {
        configFile,
        channels: sessions.channels,
        sessions,
      });
    }
    return this.contexts.get(id);
  }

  async close() {
    await Promise.all(
      [...this.contexts.values()].map(({ sessions }) => sessions.close()),
    );
  }
}

module.exports = { WorkspaceManager };
