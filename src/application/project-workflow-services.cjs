const { ProjectContentStore } = require("../storage/project-content-store.cjs");
const { accountError } = require("../domain/account.cjs");
const { assertIssueWritable } = require("../domain/issue-workflows.cjs");
const { workflowHandler, canProcessWorkflowStep, assertTransitionFields } = require("../domain/workflow-actions.cjs");
const { workflowEventEdge, workflowActorAllowed } = require("../domain/workflow-handoffs.cjs");

class ProjectWorkflowServices {
  constructor(database, projects) { this.store = new ProjectContentStore(database); this.projects = projects; }
  async validate(issue, actor, edge, context = {}) {
    assertIssueWritable(issue);
    if (!edge || edge.from !== issue.status) throw accountError("当前流程步骤已变化，请刷新。", 409);
    const { permissions } = await this.projects.authorize(issue.projectId, actor, "issue.view");
    if (!workflowActorAllowed(issue, edge, actor.id, permissions, context)) throw accountError("此动作未分派给你，请核对当前处理人。", 403);
    await this.projects.authorize(issue.projectId, actor, edge.trigger === "development.assigned" ? (context.executorId === actor.id ? "session.start" : "issue.assign") : edge.permission);
    assertTransitionFields(issue, edge);
    if (edge.requiresReason && !context.reason?.trim()) throw accountError("本次流转必须填写原因。", 400);
    const delivery = context.delivery || (edge.requireDelivery || edge.requireAcceptedDelivery ? await this.store.latestDelivery(issue.projectId, issue.id) : null);
    if (edge.requireDelivery && (!delivery || delivery.status === "returned" && edge.trigger !== "verification.returned")) throw accountError("需要本次有效交付才能流转。", 409);
    if (edge.requireAcceptedDelivery && delivery?.status !== "accepted") throw accountError("需要先通过最新交付的验收。", 409);
    if (edge.trigger === "manual" && (await this.store.latestDelivery(issue.projectId, issue.id))?.status === "pending") throw accountError("请先在交付详情完成本轮验证，再进行人工流转。", 409);
    const next = issue.workflowVersion.definition.nodes.find(node => node.id === edge.to);
    const handlerId = edge.assignment === "selection" ? context.handlerId || workflowHandler(issue, next)
      : edge.assignment === "reviewer" ? context.reviewerId
        : edge.assignment === "executor" ? context.executorId || issue.developerId : workflowHandler(issue, next);
    if (context.handlerId && edge.assignment !== "selection") throw accountError("此流转不允许手动选择处理人。", 400);
    if (!["completed", "cancelled"].includes(next.kind)) {
      if (!handlerId) throw accountError("请明确下一步骤处理人。", 409);
      await this.store.members(issue.projectId, [handlerId]);
      const target = await this.projects.authorize(issue.projectId, { id: handlerId }, "issue.view");
      if (!canProcessWorkflowStep(issue, next, target.permissions)) throw accountError("下一处理人没有目标步骤的操作权限。", 403);
      if (next.category === "development" && next.handler === "developer" && handlerId !== issue.developerId) throw accountError("开发步骤必须交给当前开发负责人。", 409);
    }
    return { handlerId, explicitHandler: edge.assignment !== "role" };
  }
  async apply(issue, actor, edge, context = {}) {
    const assignment = await this.validate(issue, actor, edge, context);
    return this.store.updateIssue(issue.projectId, issue.id, actor.id, issue.revision, { status: edge.to }, "transition", {
      ...assignment, reason: context.reason || "", trigger: edge.trigger, transitionId: edge.id,
      ...(context.delivery ? { deliveryId: context.delivery.id } : {}), ...(context.turnId ? { turnId: context.turnId } : {}),
    });
  }
  async event(issue, actor, trigger, context = {}) {
    return this.apply(issue, actor, workflowEventEdge(issue, trigger), context);
  }
  async assertCurrentDelivery(delivery) {
    if (!delivery.issueId) return null;
    const issue = await this.store.issue(delivery.projectId, delivery.issueId);
    const latest = await this.store.latestDelivery(delivery.projectId, delivery.issueId);
    if (latest?.id !== delivery.id || !delivery.actionId || issue.actions[0]?.id !== delivery.actionId) throw accountError("交付不属于当前验证轮次，请刷新后查看最新交付。", 409);
    return issue;
  }
}
module.exports = { ProjectWorkflowServices };
