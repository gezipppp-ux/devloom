const { isDeepStrictEqual } = require("node:util");
const { ProjectContentStore } = require("../storage/project-content-store.cjs");
const { SystemWorkflowStore } = require("../storage/system-workflow-store.cjs");
const { workflowUpgradeInput, workflowUpgradePreview } = require("../domain/workflow-version-upgrade.cjs");
const { canProcessWorkflowStep } = require("../domain/workflow-actions.cjs");
const { accountError } = require("../domain/account.cjs");
const { presentIssue } = require("./project-content-presenter.cjs");

class IssueWorkflowVersionServices {
  constructor(database, projects) { this.store = new ProjectContentStore(database); this.workflows = new SystemWorkflowStore(database); this.projects = projects; }
  async authorize(projectId, actor) {
    let context;
    for (const permission of ["issue.view", "issue.assign", "issue.transition"]) context = await this.projects.authorize(projectId, actor, permission);
    return context;
  }
  async plan(projectId, issueId) {
    const issue = await this.store.issue(projectId, issueId);
    const workflow = await this.workflows.workflow(issue.type);
    const preview = workflowUpgradePreview(issue, workflow, await this.store.workflowSwitchState(projectId, issueId));
    await this.store.members(projectId, [preview.handlerId]);
    const { permissions } = await this.projects.authorize(projectId, { id: preview.handlerId }, "issue.view");
    const target = workflow.versions.find(version => version.id === preview.targetVersionId);
    if (!canProcessWorkflowStep({ ...issue, workflowVersion: target }, target.definition.nodes.find(node => node.id === issue.status), permissions)) throw accountError("当前处理人没有新流程节点的操作权限。", 409);
    return { issue, preview };
  }
  async preview(projectId, issueId, actor) {
    await this.authorize(projectId, actor);
    const result = await this.store.transaction(async () => {
      try {
        const { preview } = await this.plan(projectId, issueId);
        return { ...preview, people: await this.store.people([preview.handlerId]) };
      } catch (error) {
        if (error.statusCode !== 409) throw error;
        return { available: false, reason: error.message };
      }
    });
    await this.authorize(projectId, actor);
    return result;
  }
  async upgrade(projectId, issueId, actor, raw) {
    const input = workflowUpgradeInput(raw);
    await this.authorize(projectId, actor);
    return this.store.transaction(async () => {
      const { permissions } = await this.authorize(projectId, actor);
      const previous = await this.store.workflowSwitchRequest(projectId, issueId, actor.id, input.requestId);
      if (previous) {
        if (!isDeepStrictEqual(previous.data.request, input)) throw accountError("相同请求标识不能改变切换内容。", 409);
        return presentIssue(await this.store.issue(projectId, issueId), actor.id, permissions);
      }
      const { issue, preview } = await this.plan(projectId, issueId);
      if (["issueRevision", "actionRevision", "targetVersionId"].some(key => input[key] !== preview[key]) || JSON.stringify(input.tasks) !== JSON.stringify(preview.tasks)) throw accountError("事项、任务或流程已变化，请重新预览后提交。", 409);
      const saved = await this.store.updateIssue(projectId, issueId, actor.id, input.issueRevision, { workflowVersionId: input.targetVersionId }, "workflow.upgraded", {
        handlerId: preview.handlerId, explicitHandler: true, requestId: input.requestId, request: input, reason: input.reason,
        previousWorkflowVersionId: issue.workflowVersionId, workflowVersionId: input.targetVersionId,
      });
      await this.authorize(projectId, actor);
      return presentIssue(saved, actor.id, permissions);
    });
  }
}

module.exports = { IssueWorkflowVersionServices };
