const { ProjectStore } = require("../storage/project-store.cjs");
const { GitAccountStore } = require("../storage/git-account-store.cjs");
const { listRemoteBranches } = require("../git/remote-branches.cjs");
const { accountError } = require("../domain/account.cjs");
const { presentProjectBranches } = require("./project-branch-presenter.cjs");

class ProjectBranchServices {
  constructor(database, projects, { listBranches = listRemoteBranches } = {}) {
    this.store = new ProjectStore(database);
    this.accounts = new GitAccountStore(database);
    this.projects = projects;
    this.listBranches = listBranches;
  }
  async list(projectId, actor) {
    await this.projects.authorize(projectId, actor, "issue.view");
    await this.projects.authorize(projectId, actor, "session.start");
    const space = await this.store.space(projectId, actor.id);
    if (!space || space.status !== "ready" || !space.workspaceId || !space.gitAccountId)
      throw accountError("请先准备自己的开发空间，再获取远端分支。", 409);
    const config = await this.store.readWorkspace(space.workspaceId, actor.id);
    const account = await this.accounts.read(space.gitAccountId, actor.id);
    const result = await this.listBranches(config.execution.repository, { account, remoteUrl: config.execution.remoteUrl });
    await this.projects.authorize(projectId, actor, "issue.view");
    await this.projects.authorize(projectId, actor, "session.start");
    const current = await this.store.space(projectId, actor.id);
    if (current?.revision !== space.revision || current?.workspaceId !== space.workspaceId ||
        (await this.accounts.read(space.gitAccountId, actor.id)).revision !== account.revision)
      throw accountError("开发空间或 Git 账号已变化，请重新获取分支。", 409);
    return presentProjectBranches(result);
  }
}

module.exports = { ProjectBranchServices };
