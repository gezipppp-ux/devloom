const { WorkbenchStore } = require("../storage/workbench-store.cjs");
const { pageInput, choice, text, ISSUE_TYPES, PRIORITIES } = require("../domain/project-issues.cjs");
const { accountError } = require("../domain/account.cjs");
const { presentWorkbenchPage, presentProjectActivity, presentRecentProjects } = require("./workbench-presenter.cjs");
const { WorkActionQueryStore } = require("../storage/work-action-query-store.cjs");
const { presentWorkActions } = require("./work-action-presenter.cjs");
const { issueWorkflowNode } = require("../domain/issue-workflows.cjs");
const { workflowHandler, canProcessWorkflowStep } = require("../domain/workflow-actions.cjs");

class WorkbenchServices {
  constructor(database, projects, { workspaces } = {}) { this.store = new WorkbenchStore(database); this.actionStore = new WorkActionQueryStore(database); this.projects = projects; this.workspaces = workspaces; }
  async actionSnapshot(actor, input = {}) {
    const directory = await this.projects.list(actor);
    const projects = directory.projects.filter(project => project.status === "active" && (!input.projectId || project.id === input.projectId));
    if (input.projectId && !projects.length) throw accountError("无权访问此项目的工作。", 403);
    const pending = new Map();
    const sessions = [];
    if (this.workspaces) for (const space of await this.actionStore.ownedSpaces(actor.id)) {
      const project = projects.find(project => project.id === space.projectId);
      if (!project || !["session.view", "session.approve"].every(p => project.permissions.includes(p))) continue;
      await this.projects.workspaceAuthorization(space.workspaceId, actor, "session.approve");
      for (const session of await this.workspaces.pendingRequests(space.workspaceId, actor)) {
        const requests = session.requests.filter(request => request.blocking !== false);
        pending.set(`${space.workspaceId}/${session.key}`, requests);
        if (requests.length) sessions.push({ ...session, requests, workspaceId: space.workspaceId, projectId: project.id });
      }
      await this.projects.workspaceAuthorization(space.workspaceId, actor, "session.approve");
    }
    const snapshot = await this.actionStore.snapshot(projects.map(project => project.id), actor.id);
    for (const action of snapshot.actions) {
      const handlerId = workflowHandler(action.issue, issueWorkflowNode(action.issue));
      action.assignmentProblem = !handlerId;
      if (handlerId) try {
        const context = await this.projects.authorize(action.projectId, { id: handlerId }, "issue.view");
        action.assignmentProblem = !canProcessWorkflowStep(action.issue, issueWorkflowNode(action.issue), context.permissions);
      } catch (error) { if (![401, 403, 404, 409].includes(error.statusCode)) throw error; action.assignmentProblem = true; }
    }
    snapshot.actions = snapshot.actions.filter(action => action.assignmentProblem ? action.issue.businessOwnerId === actor.id : action.handlerId === actor.id);
    for (const task of snapshot.tasks) {
      try {
        const { permissions } = await this.projects.authorize(task.projectId, { id: task.executorId }, "session.start");
        task.assignmentProblem = !permissions.includes("issue.view");
      }
      catch (error) { if (![401, 403, 404, 409].includes(error.statusCode)) throw error; task.assignmentProblem = true; }
    }
    snapshot.tasks = snapshot.tasks.filter(task => task.assignmentProblem
      ? task.snapshot.kind === "manual" ? task.creatorId === actor.id : task.issueLinks.some(link => link.issue.businessOwnerId === actor.id && link.issue.release?.status !== "archived")
      : task.executorId === actor.id);
    for (const delivery of snapshot.deliveries.filter(delivery => delivery.status === "pending")) {
      try { await this.projects.authorize(delivery.projectId, { id: delivery.reviewerId }, "deliverable.review"); }
      catch (error) { if (![401, 403, 404, 409].includes(error.statusCode)) throw error; delivery.assignmentProblem = true; }
    }
    snapshot.deliveries = snapshot.deliveries.filter(delivery => delivery.status === "returned" || (delivery.assignmentProblem ? (delivery.issue?.businessOwnerId || delivery.authorId) === actor.id : delivery.reviewerId === actor.id));
    // Discard the complete response, including counts, if any authorization changed.
    for (const project of projects) {
      const current = await this.projects.authorize(project.id, actor, "project.view");
      if (JSON.stringify(current.permissions) !== JSON.stringify(project.permissions) || current.project.status !== "active") throw accountError("项目权限已变化，请刷新。", 403);
    }
    return presentWorkActions({ ...snapshot, sessions }, projects, pending);
  }
  async actions(actor, input = {}) {
    const page = pageInput(input);
    const bucket = input.bucket ? choice(input.bucket, ["todo", "doing", "verify"], "工作栏目") : null;
    const all = (await this.actionSnapshot(actor, input)).filter(item => !page.query || (item.title + " " + item.projectName).toLowerCase().includes(page.query.toLowerCase()));
    const items = all.filter(item => !bucket || item.bucket === bucket);
    return { items: items.slice(page.offset, page.offset + page.limit), total: items.length, nextOffset: page.offset + page.limit < items.length ? page.offset + page.limit : null,
      counts: Object.fromEntries(["todo", "doing", "verify"].map(key => [key, all.filter(item => item.bucket === key).length])) };
  }
  async recentProjects(actor) {
    const { projects } = await this.projects.list(actor);
    const visits = await this.store.recentProjects(actor.id, projects.map(project => project.id));
    for (const visit of visits) await this.projects.authorize(visit.projectId, actor, "project.view");
    return presentRecentProjects(visits, projects);
  }
  async activity(id, actor) {
    const { permissions } = await this.projects.authorize(id, actor, "issue.view");
    const deliveries = permissions.includes("collaboration.view");
    const rows = await this.store.activity(id, { deliveries });
    await this.projects.authorize(id, actor, "issue.view");
    if (deliveries) await this.projects.authorize(id, actor, "collaboration.view");
    return presentProjectActivity(id, rows);
  }
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
    return presentWorkbenchPage(kind, result, projects, actor.id);
  }
}
module.exports = { WorkbenchServices };
