const { ProjectLifecycleStore } = require("../storage/project-lifecycle-store.cjs");
const { object, text, revision } = require("../domain/project-issues.cjs");
const { presentRelease } = require("./project-lifecycle-presenter.cjs");

class ProjectLifecycleServices {
  constructor(database, projects) { this.store = new ProjectLifecycleStore(database); this.projects = projects; }
  async operation(projectId, actor, permission, operation) {
    await this.projects.authorize(projectId, actor, permission);
    return this.store.transaction(async () => {
      await this.projects.authorize(projectId, actor, permission);
      const result = await operation();
      await this.projects.authorize(projectId, actor, permission);
      return result;
    });
  }
  async listReleases(projectId, actor, input = {}) { return this.operation(projectId, actor, "issue.view", async () => ({ items: (await this.store.releases(projectId, input.archived === "1" || input.archived === "true" || input.includeArchived === "true")).map(presentRelease) })); }
  async saveRelease(projectId, id, actor, input) {
    object(input, ["name", "description", ...(id ? ["revision"] : [])]);
    const data = { name: text(input.name, "版本名称", 100, { required: true }), description: text(input.description ?? "", "版本说明", 4000) };
    if (id) revision(input.revision);
    return this.operation(projectId, actor, "release.manage", async () => presentRelease(await this.store.saveRelease(projectId, id, input.revision, data)));
  }
  async archiveRelease(projectId, id, actor, input, archive) {
    object(input, ["revision"]); revision(input.revision);
    return this.operation(projectId, actor, "release.manage", async () => presentRelease(await this.store.archiveRelease(projectId, id, input.revision, archive)));
  }
}
module.exports = { ProjectLifecycleServices };
