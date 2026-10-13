const path = require("node:path");
const { dataRoot } = require("../config/runtime.cjs");
const { WorkspaceStore } = require("../storage/workspace-store.cjs");
const { AgentSupplierStore } = require("../storage/agent-supplier-store.cjs");
const {
  defaultChannels,
  defaultChannelConfig,
} = require("../channels/channel-registry.cjs");
const { SessionManager } = require("./session-manager.cjs");
const { defaultProjectName } = require("../domain/member-project-paths.cjs");
const { memberDirectoryName } = require("../domain/member-project-paths.cjs");
const { readSystemSettings } = require("../config/system-settings.cjs");
const { GitAccountStore } = require("../storage/git-account-store.cjs");
const { ProjectDevelopmentStore } = require("../storage/project-development-store.cjs");
const { accountError } = require("../domain/account.cjs");
const { issueDevelopmentAllowed } = require("../domain/issue-workflows.cjs");
const {
  gitAccountId,
  remoteUrl,
  remoteAuthType,
  projectName,
} = require("../domain/git-account.cjs");
const { validateWorkspaceInput } = require("../domain/workspace.cjs");
const { cloneProject } = require("../git/project-clone.cjs");
const { createGitCredentialEnvironment } = require("../git/account-credentials.cjs");
const { agentConfig } = require("../domain/agent-config.cjs");

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
    this.closing = false;
  }

  configFile(id) {
    return this.store.configFile(id);
  }

  owner(actor) {
    if (this.store.database && (!actor?.id || actor.status === "disabled"))
      throw Object.assign(new Error("请先登录。"), { statusCode: 401 });
    return actor?.id;
  }

  async read(id, actor) {
    return presentWorkspace((await this.store.read(id, this.owner(actor))));
  }

  async list(actor) {
    return (await this.store
      .list(this.owner(actor)))
      .map(presentWorkspace)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async save(input, id, actor, createConfig) {
    const owner = this.owner(actor);
    return presentWorkspace(
      (await this.store.save(
        input,
        id,
        async (key) =>
          (await createConfig?.(key)) || {
            version: 3,
            execution: { projectName: defaultProjectName(key) },
            agent: { provider: "codex", model: "", reasoningEffort: "", permissionMode: "ask", options: {} },
            ...defaultChannelConfig(),
          },
        owner,
      )),
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
    if ((await this.list(actor)).some((entry) => entry.name === workspace.name))
      throw new Error("工作区名称已存在。");
    const gitAccounts = new GitAccountStore(this.store.database);
    const account = (await gitAccounts.read(gitAccountId(input.gitAccountId), owner));
    if (account.authType !== remoteAuthType(remote))
      throw new Error("所选 Git 账号的认证方式与远程地址协议不匹配。");
    const directory = projectName(remote);
    const { memberStorageRoot } = (await readSystemSettings(
      path.dirname(this.directory),
    ));
    const member = memberDirectoryName(actor.username);
    const projectPath = path.join(
      memberStorageRoot,
      member,
      "projects",
      directory,
    );
    return (await this.cloneProject({
      account,
      remote,
      target: projectPath,
      memberStorageRoot,
      signal: options.signal,
      onProgress: options.onProgress,
      publish: async () => {
        const create = async () => (await this.save(workspace, undefined, actor, async () => {
          // WorkspaceStore invokes this inside its short write transaction,
          // serializing publication with account updates and deletion.
          await authorize?.();
          if ((await gitAccounts.read(account.id, owner)).revision !== account.revision)
            throw new Error("Git 账号已更改，请重新创建工作区。");
          return {
            version: 4,
            execution: {
              repository: projectPath,
              projectName: directory,
              gitAccountId: account.id,
              remoteUrl: remote,
              baseBranch: "",
              initCommands: [],
            },
            agent: { provider: "codex", model: "", reasoningEffort: "", permissionMode: "ask", options: {} },
            ...defaultChannelConfig(),
          };
        }));
        return options.publish ? options.publish(create) : (await create());
      },
    }));
  }

  async get(id, actor) {
    const config = (await this.store.read(id, this.owner(actor)));
    if (this.closing) throw new Error("工作区服务正在关闭，不能继续操作。");
    if (!this.contexts.has(id)) {
      const { configFile, uploadDirectory, runsDirectory } =
        this.store.paths(id);
      const channels = defaultChannels(configFile, { uploadDirectory });
      const gitCredentialProvider =
        this.store.database &&
        config.execution?.gitAccountId &&
        config.execution?.remoteUrl &&
        config.workspace?.owner_user_id
          ? async () => {
              const account = (await new GitAccountStore(this.store.database).read(
                config.execution.gitAccountId,
                config.workspace.owner_user_id,
              ));
              return (await createGitCredentialEnvironment(
                account,
                config.execution.remoteUrl,
              ));
            }
          : undefined;
      const gitCredentialRevision = gitCredentialProvider
        ? async () => (await new GitAccountStore(this.store.database).read(
            config.execution.gitAccountId, config.workspace.owner_user_id,
          )).revision
        : undefined;
      const sessions = this.createManager({
        supplierStore: this.store.database ? new AgentSupplierStore(this.store.database) : undefined,
        workspaceId: id,
        configFile,
        agentConfig: agentConfig(config),
        channels,
        runsDirectory,
        apiPrefix: `/api/workspaces/${id}`,
        gitCredentialProvider,
        gitCredentialRevision,
        gitOperationCredentials: this.store.database ? async current => {
          if (!current.execution?.gitAccountId) return undefined;
          return {
            account: await new GitAccountStore(this.store.database).read(
              current.execution.gitAccountId, current.workspace.owner_user_id,
            ),
            remoteUrl: current.execution.remoteUrl,
          };
        } : undefined,
        authorize: permission => this.authorizeProject?.(id, { id: config.workspace.owner_user_id }, permission),
        authorizeRun: this.store.database ? async (key, operation) => {
          const development = new ProjectDevelopmentStore(this.store.database);
          const task = await development.taskForRun(id, key);
          if (task && ["completed", "cancelled"].includes(task.status)) throw accountError("开发任务已结束，不能继续执行或处理审批。", 409);
          if (task?.release?.status === "archived") throw accountError("任务发布版本已归档，不能继续执行。", 409);
          if (task && operation === "start") {
            const issues = await development.issues(task.projectId, task.snapshot.issues.map(issue => issue.id));
            if (issues.some(issue => !issueDevelopmentAllowed(issue))) throw accountError("事项当前流程节点不允许开发，请核对事项后处理已记录任务。", 409);
          }
        } : undefined,
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
    this.closing = true;
    await Promise.all(
      [...this.contexts.values()].map(({ sessions }) => sessions.close()),
    );
  }

  async suppliersChanged() {
    for (const { sessions } of this.contexts.values()) {
      sessions.emit("event", { type: "supplier-changed" });
      for (const key of sessions.sessions.keys()) {
        if (await sessions.store.hasRun(key)) await sessions.settings.publish(key);
      }
    }
  }
}

module.exports = { WorkspaceManager };
