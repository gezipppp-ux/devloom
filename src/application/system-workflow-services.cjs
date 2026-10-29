const { SystemWorkflowStore } = require("../storage/system-workflow-store.cjs");
const { object, revision, choice, ISSUE_TYPES } = require("../domain/project-issues.cjs");
const { workflowDefinition } = require("../domain/issue-workflows.cjs");
const { presentWorkflow } = require("./system-workflow-presenter.cjs");
const { accountError } = require("../domain/account.cjs");

class SystemWorkflowServices {
  constructor(database, accounts, projects) { this.store = new SystemWorkflowStore(database); this.accounts = accounts; this.projects = projects; }
  async operation(authorize, operation) {
    await authorize();
    const result = await this.store.transaction(async () => {
      await authorize();
      const result = await operation();
      await authorize();
      return result;
    });
    await authorize();
    return result;
  }
  async readWorkflow(type, actor) {
    choice(type, ISSUE_TYPES, "流程类型");
    return this.operation(() => this.accounts.requireAdmin(actor), async () => ({ ...presentWorkflow(await this.store.workflow(type)), statusUsage: await this.store.statusUsage(type) }));
  }
  async saveWorkflow(type, actor, input, publish = false) {
    choice(type, ISSUE_TYPES, "流程类型"); object(input, publish ? ["revision", "mapping"] : ["revision", "definition"]); revision(input.revision);
    if (publish && input.mapping !== undefined && (!input.mapping || typeof input.mapping !== "object" || Array.isArray(input.mapping) || Object.values(input.mapping).some(value => typeof value !== "string"))) throw accountError("状态映射无效。", 400);
    return this.operation(() => this.accounts.requireAdmin(actor), async () => {
      const definition = workflowDefinition(publish ? (await this.store.workflow(type)).draft : input.definition, { publish });
      const saved = await this.store.save(type, input.revision, definition, publish);
      if (publish) await this.store.applyPublished(type, saved.versions.find(version => version.version === saved.publishedVersion), definition, input.mapping || {}, actor.id);
      return { ...presentWorkflow(saved), statusUsage: await this.store.statusUsage(type) };
    });
  }
  async readPublished(projectId, type, actor) {
    choice(type, ISSUE_TYPES, "流程类型");
    return this.operation(() => this.projects.authorize(projectId, actor, "issue.view"), async () => presentWorkflow(await this.store.workflow(type), { publishedOnly: true }));
  }
}
module.exports = { SystemWorkflowServices };
