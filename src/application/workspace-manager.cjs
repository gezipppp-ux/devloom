const path = require("node:path");
const { dataRoot } = require("../config/runtime.cjs");
const { WorkspaceStore } = require("../storage/workspace-store.cjs");
const {
  defaultChannels,
  defaultChannelConfig,
} = require("../channels/channel-registry.cjs");
const { SessionManager } = require("./session-manager.cjs");
const { defaultProjectName } = require("../domain/member-project-paths.cjs");
const { memberDirectoryName } = require("../domain/member-project-paths.cjs");
const { readSystemSettings } = require("../config/system-settings.cjs");
const { GitAccountStore } = require("../storage/git-account-store.cjs");
const {
  gitAccountId,
  remoteUrl,
  remoteAuthType,
  projectName,
} = require("../domain/git-account.cjs");
const { validateWorkspaceInput } = require("../domain/workspace.cjs");
const { cloneProject } = require("../git/project-clone.cjs");

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
    cloneProject: clone = cloneProject,
  } = {}) {
    this.store = new WorkspaceStore(directory, database);
    this.directory = this.store.directory;
    this.createManager = createManager;
    this.cloneProject = clone;
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
    return this.store
      .list(this.owner(actor))
      .map(presentWorkspace)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  save(input, id, actor, createConfig) {
    const owner = this.owner(actor);
    return presentWorkspace(
      this.store.save(
        input,
        id,
        (key) =>
          createConfig?.(key) || {
            version: 3,
            codex: { project_name: defaultProjectName(key) },
            ...defaultChannelConfig(),
          },
        owner,
      ),
    );
  }

  async createFromGit(input, actor, authorize, options = {}) {
    const owner = this.owner(actor);
    if (!this.store.database)
      throw new Error("从 Git 创建工作区需要数据库存储。");
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) => !["name", "icon", "remoteUrl", "gitAccountId"].includes(key),
      )
    )
      throw new Error("新建工作区包含未知字段。");
    const remote = remoteUrl(input.remoteUrl);
    const workspace = validateWorkspaceInput({
      name: input.name,
      ...(input.icon === undefined ? {} : { icon: input.icon }),
    });
    if (this.list(actor).some((entry) => entry.name === workspace.name))
      throw new Error("工作区名称已存在。");
    const gitAccounts = new GitAccountStore(this.store.database);
    const account = gitAccounts.read(gitAccountId(input.gitAccountId), owner);
    if (account.authType !== remoteAuthType(remote))
      throw new Error("所选 Git 账号的认证方式与远程地址协议不匹配。");
    const directory = projectName(remote);
    const { memberStorageRoot } = readSystemSettings(
      path.dirname(this.directory),
    );
    const member = memberDirectoryName(actor.username);
    const projectPath = path.join(
      memberStorageRoot,
      member,
      "projects",
      directory,
    );
    return this.cloneProject({
      account,
      remote,
      target: projectPath,
      memberStorageRoot,
      signal: options.signal,
      onProgress: options.onProgress,
      publish: () => {
        const create = () => this.save(workspace, undefined, actor, () => {
          // WorkspaceStore invokes this inside its short write transaction,
          // serializing publication with account updates and deletion.
          authorize?.();
          if (gitAccounts.read(account.id, owner).revision !== account.revision)
            throw new Error("Git 账号已更改，请重新创建工作区。");
          return {
            version: 4,
            codex: {
              repository: projectPath,
              project_name: directory,
              git_account_id: account.id,
              remote_url: remote,
              base_ref: "HEAD",
              init_commands: [],
            },
            ...defaultChannelConfig(),
          };
        });
        return options.publish ? options.publish(create) : create();
      },
    });
  }

  get(id, actor) {
    this.read(id, actor);
    if (!this.contexts.has(id)) {
      const { configFile, uploadDirectory, runsDirectory } =
        this.store.paths(id);
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
