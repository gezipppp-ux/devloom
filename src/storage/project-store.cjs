const { accountError } = require("../domain/account.cjs");
const { randomUUID } = require("node:crypto");
const { projectDirectoryName } = require("../domain/member-project-paths.cjs");

class ProjectStore {
  constructor(database) { this.database = database; }
  async transaction(operation, { reserveDirectory = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.database.transaction(operation); }
      catch (error) {
        if (!["P2002", "P2034"].includes(error.code)) throw error;
        // A concurrent directory reservation must re-read the committed names.
        if (!reserveDirectory || attempt >= 2) throw accountError("项目资料已变更，请刷新后重试。", 409, "REVISION_CONFLICT");
      }
    }
  }
  async user(id) { return this.database.client.user.findUnique({ where: { id }, include: { department: true } }); }
  async departments() { return this.database.client.department.findMany({ orderBy: { name: "asc" } }); }
  async project(id) { return this.database.client.project.findUnique({ where: { id }, include: { _count: { select: { spaces: true } } } }); }
  async membership(projectId, userId) { return this.database.client.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } }); }
  async members(projectId) { return this.database.client.projectMember.findMany({ where: { projectId }, include: { user: { include: { department: true } } }, orderBy: { createdAt: "asc" } }); }
  async users() { return this.database.client.user.findMany({ where: { status: "active" }, include: { department: true }, orderBy: { username: "asc" } }); }
  async projects(userId, { includeAll = false } = {}) { return this.database.client.project.findMany({ where: includeAll ? {} : { members: { some: { userId, status: "active" } } }, include: { _count: { select: { spaces: true } } }, orderBy: { updatedAt: "desc" } }); }
  async saveCatalog(model, value, id) {
    const { revision, ...data } = value;
    try {
      if (!id) return await this.database.client[model].create({ data });
      const result = await this.database.client[model].updateMany({ where: { id, revision }, data: { ...data, revision: { increment: 1 } } });
      if (!result.count) throw accountError("资料已变更，请刷新后重试。", 409, "REVISION_CONFLICT");
      return this.database.client[model].findUnique({ where: { id } });
    } catch (error) {
      if (error.code === "P2002" && model === "project") throw error;
      if (error.code === "P2002") throw accountError("名称已存在。", 409);
      throw error;
    }
  }
  async spaceCount(projectId) { return this.database.client.developmentSpace.count({ where: { projectId } }); }
  async savePromptPreferences(projectId, userId, promptRevision, prompts) {
    const result = await this.database.client.projectMember.updateMany({
      where: { projectId, userId, promptRevision, status: "active" },
      data: { prompts, promptRevision: { increment: 1 } },
    });
    if (!result.count) throw accountError("个人提示词已变更，请保留草稿并加载最新配置。", 409, "REVISION_CONFLICT");
  }
  async saveProject(value, id) {
    const data = { ...value };
    const current = id ? await this.project(id) : null;
    if (!id) data.id = randomUUID();
    if (!current || (value.remoteUrl && projectDirectoryName(value.remoteUrl) !== projectDirectoryName(current.remoteUrl))) {
      const shortId = (id || data.id).slice(0, 8);
      for (let attempt = 0; attempt < 100; attempt++) {
        const suffix = attempt ? `${shortId}${attempt > 1 ? `-${attempt}` : ""}` : "";
        const directoryName = projectDirectoryName(value.remoteUrl, suffix);
        const directoryKey = directoryName.toLowerCase();
        const occupant = await this.database.client.project.findUnique({ where: { directoryKey } });
        if (occupant && occupant.id !== id) continue;
        Object.assign(data, { directoryName, directoryKey });
        break;
      }
      if (!data.directoryName) throw accountError("无法分配项目目录，请重试。", 409);
    }
    return this.saveCatalog("project", data, id);
  }
  async saveMember(projectId, userId, value, updating) {
    const { revision, ...data } = value;
    delete data.userId;
    if (updating) {
      if (!(await this.database.client.projectMember.updateMany({ where: { projectId, userId, revision }, data: { ...data, revision: { increment: 1 } } })).count)
        throw accountError("成员资料已变更，请刷新后重试。", 409, "REVISION_CONFLICT");
    } else {
      if (await this.membership(projectId, userId)) throw accountError("成员关系已存在，请使用当前修订号更新。", 409);
      await this.database.client.projectMember.create({ data: { projectId, userId, ...data } });
    }
    return this.membership(projectId, userId);
  }
  async space(projectId, userId) { return this.database.client.developmentSpace.findUnique({ where: { projectId_userId: { projectId, userId } } }); }
  async workspaceSpace(workspaceId) { return this.database.client.developmentSpace.findUnique({ where: { workspaceId } }); }
  async allocateSpace(projectId, userId) {
    return this.database.client.developmentSpace.upsert({ where: { projectId_userId: { projectId, userId } }, create: { projectId, userId }, update: {} });
  }
  async updateSpace(id, revision, data) {
    if (!(await this.database.client.developmentSpace.updateMany({ where: { id, revision }, data: { ...data, revision: { increment: 1 } } })).count)
      throw accountError("开发空间状态已变更，请刷新后重试。", 409, "REVISION_CONFLICT");
    return this.database.client.developmentSpace.findUnique({ where: { id } });
  }
  async projectSpaces(projectId) { return this.database.client.developmentSpace.findMany({ where: { projectId } }); }
  async audit(actor, event, details) { return this.database.client.auditEvent.create({ data: { actorUserId: actor.id, event, details } }); }
  async recoverSpaces() {
    for (const row of await this.database.client.developmentSpace.findMany({ where: { status: "preparing" } })) {
      let alive = false;
      if (Number.isInteger(row.workerPid) && row.workerPid > 0) {
        try { process.kill(row.workerPid, 0); alive = true; }
        catch (error) { if (error.code !== "ESRCH") alive = true; }
      }
      if (!alive) await this.updateSpace(row.id, row.revision, { status: "failed", workerPid: null, error: "服务已重启，准备结果不确定。请检查保留目录后明确重试。" });
    }
  }
  async writeWorkspace(id, config) { return this.database.writeWorkspace(id, config); }
  async readWorkspace(id, userId) { return this.database.readWorkspace(id, userId); }
}
module.exports = { ProjectStore };
