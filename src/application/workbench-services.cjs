const { WorkbenchStore } = require("../storage/workbench-store.cjs");
const { pageInput, choice, text, ISSUE_TYPES, PRIORITIES } = require("../domain/project-issues.cjs");
const { accountError } = require("../domain/account.cjs");
const { presentWorkbenchPage } = require("./workbench-presenter.cjs");

class WorkbenchServices {
  constructor(database, projects) { this.store = new WorkbenchStore(database); this.projects = projects; }
  async list(kind, actor, input = {}) {
    choice(kind, ["issues", "tasks", "deliveries"], "工作类型");
    const permission = kind === "deliveries" ? "collaboration.view" : kind === "tasks" ? "session.view" : "issue.view";
    const page = { ...pageInput(input), scope: choice(input.scope || "all", ["all", "mine"], "范围") };
    if (input.type) page.type = choice(input.type, ISSUE_TYPES, "事项类型");
    if (input.priority) page.priority = choice(input.priority, PRIORITIES, "优先级");
    if (input.status) page.status = text(input.status, "状态", 100);
    if (input.tag) page.tag = text(input.tag, "标签", 30);
    page.active = input.active === "true";
    const directory = await this.projects.list(actor);
    const projects = directory.projects.filter(p => p.permissions.includes(permission) && (kind !== "deliveries" || p.permissions.includes("issue.view")) && (!input.projectId || p.id === input.projectId));
    if (input.projectId && !projects.length) throw accountError("无权访问此项目的内容。", 403);
    const result = await this.store.list(kind, projects.map(p => p.id), actor.id, page);
    // Recheck every scope after the query, including projects contributing only totals.
    for (const project of projects) { await this.projects.authorize(project.id, actor, permission); if (kind === "deliveries") await this.projects.authorize(project.id, actor, "issue.view"); }
    return presentWorkbenchPage(kind, result, projects);
  }
}
module.exports = { WorkbenchServices };
