const { WorkflowExecutionStore } = require("../storage/workflow-execution-store.cjs");
const { workListFilters } = require("../domain/work-list-filters.cjs");
const { WorkListFilterStore } = require("../storage/work-list-filter-store.cjs");
const { presentWorkFilters } = require("./work-list-presenter.cjs");
const { issueDeletionReason } = require("../domain/issue-deletion.cjs");
const { issueAttachments, projectFileInput, previewMimeType } = require("../domain/project-files.cjs");
const { ProjectContentStore } = require("../storage/project-content-store.cjs");
const { issueRequestId, issueInput, issueTransition, pageInput, text, object, identifier, choice, ISSUE_TYPES, contentFields, assignmentFields } = require("../domain/project-issues.cjs");
const { assetInput, ASSET_TYPES } = require("../domain/project-assets.cjs");
const { accountError } = require("../domain/account.cjs");
const { deliveryChecklist, deliveryReview } = require("../domain/deliverable-review.cjs");
const { responsibilityFields, revision } = require("../domain/project-issues.cjs");
const { issueWorkflowNode, assertIssueWritable } = require("../domain/issue-workflows.cjs");
const { canProcessWorkflowStep } = require("../domain/workflow-actions.cjs");
const { ProjectWorkflowServices } = require("./project-workflow-services.cjs");
const { currentHandler, workflowEventEdge } = require("../domain/workflow-handoffs.cjs");
const { deliveryReviewer } = require("../domain/delivery-submission.cjs");
const { ProjectDevelopmentStore } = require("../storage/project-development-store.cjs");
const { IssueWorkflowVersionServices } = require("./issue-workflow-version-services.cjs");
const { presentDevelopment } = require("./project-development-presenter.cjs");
const { presentIssueImages, presentIssue, presentIssueAssignment, presentAsset, presentProjectFile, presentPage, presentDeliverable } = require("./project-content-presenter.cjs");

class ProjectContentServices {
  constructor(database, projects) {
    this.store = new ProjectContentStore(database);
    this.projects = projects;
    this.workflow = new ProjectWorkflowServices(database, projects);
    this.development = new ProjectDevelopmentStore(database);
    this.executionWorkflow = new WorkflowExecutionStore(database);
    this.workflowVersions = new IssueWorkflowVersionServices(database, projects);
  }
  async authorized(projectId, actor, permissions) {
    let context;
    for (const permission of new Set(permissions)) context = await this.projects.authorize(projectId, actor, permission);
    return context;
  }
  async read(projectId, actor, permissions, operation) {
    await this.authorized(projectId, actor, permissions);
    const result = await operation();
    await this.authorized(projectId, actor, permissions);
    return result;
  }
  async mutate(projectId, actor, permissions, operation) {
    await this.authorized(projectId, actor, permissions);
    return this.store.transaction(async () => {
      await this.authorized(projectId, actor, permissions);
      const result = await operation();
      await this.authorized(projectId, actor, permissions);
      return result;
    });
  }
  async listIssues(projectId, actor, input) {
    const page = { ...pageInput(input), filters: workListFilters(input, "issues") };
    if (input.type) page.type = choice(input.type, ISSUE_TYPES, "事项类型");
    page.includeArchived = input.includeArchived === "true" || input.includeArchived === "1";
    page.active = input.active === "true";
    return this.read(projectId, actor, ["issue.view"], async () => {
      const { permissions } = await this.projects.authorize(projectId, actor, "issue.view");
      const result = await this.store.issues(projectId, page);
      return { ...presentPage(result, row => presentIssue(row, actor.id, permissions)), filterOptions: presentWorkFilters(await new WorkListFilterStore(this.store.database).options([projectId], { type: page.type })), people: await this.store.people(result.items.flatMap(issue => [issue.developerId, ...responsibilityFields.map(field => issue[field])])) };
    });
  }
  previewWorkflowUpgrade(projectId, issueId, actor) { return this.workflowVersions.preview(projectId, issueId, actor); }
  upgradeIssueWorkflow(projectId, issueId, actor, input) { return this.workflowVersions.upgrade(projectId, issueId, actor, input); }
  async reviewers(projectId, actor, input = {}) {
    return this.read(projectId, actor, ["collaboration.view"], async () => {
      const issue = input.issueId ? await this.store.issue(projectId, identifier(input.issueId, "事项")) : null;
      if (issue) await this.projects.authorize(projectId, actor, "issue.view");
      const edge = issue?.workflowVersion.definition.transitions.find(edge => edge.from === issue.status && edge.trigger === "delivery.submitted");
      const next = issue?.workflowVersion.definition.nodes.find(node => node.id === edge?.to);
      const items = [];
      for (const candidate of await this.store.memberCandidates(projectId)) {
        try {
          const context = await this.projects.authorize(projectId, candidate, "deliverable.review");
          if (issue && (!next || !canProcessWorkflowStep(issue, next, context.permissions))) continue;
          items.push(candidate);
        }
        catch (error) { if (![401, 403, 404, 409].includes(error.statusCode)) throw error; }
      }
      return { items };
    });
  }
  async readIssue(projectId, id, actor) {
    return this.read(projectId, actor, ["issue.view"], async () => {
      const issue = await this.store.issue(projectId, id);
      const developmentAssignment = presentIssueAssignment(await this.store.developmentAssignment(issue), issue.developerId);
      const { permissions } = await this.projects.authorize(projectId, actor, "issue.view");
      return { ...presentIssue(issue, actor.id, permissions), developmentAssignment, images: presentIssueImages(await this.store.issuePreviewFiles(projectId, id), issue.source), people: await this.store.people([issue.createdById, issue.updatedById, issue.developerId, developmentAssignment?.actorId, issue.deliverables?.[0]?.authorId, ...responsibilityFields.map(field => issue[field]), currentHandler(issue), ...issue.watcherIds]) };
    });
  }
  async createIssue(projectId, actor, input) {
    const data = issueInput(input);
    data.reporterId ??= actor.id;
    const requestId = issueRequestId(input);
    const attachments = issueAttachments(input);
    const permissions = ["issue.create", ...(data.watcherIds.length || responsibilityFields.some(field => data[field] && data[field] !== actor.id) ? ["issue.assign"] : [])];
    return this.mutate(projectId, actor, permissions, async () => {
      await this.store.members(projectId, [...data.watcherIds, ...responsibilityFields.map(field => data[field])]);
      const issue = await this.store.createIssue(projectId, actor.id, data, { requestId, attachments });
      for (const file of attachments) await this.store.addFile(projectId, "issues", issue.id, actor.id, file);
      return { ...presentIssue(issue, actor.id, (await this.projects.authorize(projectId, actor, "project.view")).permissions), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, issue.id), issue.source) };
    });
  }
  async updateIssue(projectId, id, actor, input) {
    const permissions = ["issue.view"];
    if (Object.hasOwn(input || {}, "attachments") || contentFields.some(field => Object.hasOwn(input || {}, field))) permissions.push("issue.edit");
    if (assignmentFields.some(field => Object.hasOwn(input || {}, field))) permissions.push("issue.assign");
    if (permissions.length === 1) throw accountError("请提供要修改的事项字段。", 400);
    return this.mutate(projectId, actor, permissions, async () => {
      const current = await this.store.issue(projectId, id);
      const data = issueInput(input, current);
      const attachments = issueAttachments(input);
      await this.store.members(projectId, [...(data.watcherIds || []), ...responsibilityFields.map(field => data[field])]);
      const issue = await this.store.updateIssue(projectId, id, actor.id, input.revision, data);
      for (const file of attachments) await this.store.addFile(projectId, "issues", id, actor.id, file);
      return { ...presentIssue(issue, actor.id, (await this.projects.authorize(projectId, actor, "project.view")).permissions), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, issue.id), issue.source) };
    });
  }
  async transitionIssue(projectId, id, actor, input) {
    await this.authorized(projectId, actor, ["issue.view"]);
    return this.store.transaction(async () => {
      const current = await this.store.issue(projectId, id);
      const transition = issueTransition(current, input);
      if (current.revision !== input.revision) throw accountError("事项已变化，请刷新。", 409);
      const edge = current.workflowVersion.definition.transitions.find(edge => edge.from === current.status && edge.to === transition.status && (!input.transitionId || edge.id === input.transitionId));
      const result = await this.workflow.apply(current, actor, edge, { reason: transition.reason, handlerId: input.handlerId });
      for (const taskId of await this.executionWorkflow.taskIds(id)) await this.executionWorkflow.settle(taskId);
      return { ...presentIssue(result, actor.id, (await this.projects.authorize(projectId, actor, "project.view")).permissions), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, id), result.source) };
    });
  }
  async deleteIssue(projectId, id, actor, input) {
    object(input, ["revision"]); revision(input.revision);
    return this.mutate(projectId, actor, ["issue.view", "issue.delete"], async () => {
      const issue = await this.store.issue(projectId, id);
      if (issue.revision !== input.revision) throw accountError("事项已变化，请刷新后重新确认删除。", 409);
      const reason = issueDeletionReason(issue);
      if (reason) throw accountError(reason, 409);
      await this.store.deleteIssue(projectId, id, actor.id, input.revision);
      return { id, deleted: true };
    });
  }
  async reassignIssueStep(projectId, id, actor, input) {
    object(input, ["revision", "handlerId"]); revision(input.revision);
    const handlerId = identifier(input.handlerId, "处理人");
    return this.mutate(projectId, actor, ["issue.view", "issue.assign"], async () => {
      const issue = await this.store.issue(projectId, id), node = issueWorkflowNode(issue);
      if (!issue.actions[0]) throw accountError("事项没有待处理步骤。", 409);
      if (node.handler === "developer" && handlerId !== issue.developerId) throw accountError("请通过开发任务转派开发负责人。", 409);
      const delivery = await this.store.latestDelivery(projectId, id);
      if (delivery?.status === "pending" && delivery.actionId === issue.actions[0].id) throw accountError("请通过交付详情重新指定验证人。", 409);
      await this.store.members(projectId, [handlerId]);
      const { permissions } = await this.projects.authorize(projectId, { id: handlerId }, "issue.view");
      if (!canProcessWorkflowStep(issue, node, permissions)) throw accountError("处理人没有当前步骤的操作权限。", 403);
      return presentIssue(await this.store.updateIssue(projectId, id, actor.id, input.revision, {}, "step.assigned", { handlerId, explicitHandler: true }), actor.id);
    });
  }
  async children(projectId, id, actor, kind, input) {
    return this.read(projectId, actor, [kind === "history" ? "issue.view" : "collaboration.view"], async () => {
      const page = await this.store.childList(kind, projectId, id, pageInput(input));
      const people = page.items.flatMap(row => [row.authorId || row.actorId,
        ...[row.data?.before, row.data?.after].flatMap(snapshot => [snapshot?.developerId, ...responsibilityFields.map(field => snapshot?.[field]), ...(snapshot?.watcherIds || [])])]);
      return { ...presentPage(page, kind === "deliverables" ? presentDeliverable : undefined), people: await this.store.people(people) };
    });
  }
  async addComment(projectId, id, actor, input) {
    object(input, ["body"]);
    const body = text(input.body, "评论", 60000, { required: true });
    return this.mutate(projectId, actor, ["comment.create"], async () => (await this.store.comment(projectId, id, actor.id, body)));
  }
  async addDeliverables(projectId, actor, input) {
    object(input, ["items"]);
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 20 || new Set(input.items.map(item => item.issueId)).size !== input.items.length) throw accountError("请选择 1–20 个不同事项提交交付。", 400);
    return this.mutate(projectId, actor, ["deliverable.create"], async () => {
      const items = [];
      for (const item of input.items) items.push(await this.addDeliverable(projectId, actor, item));
      return { items };
    });
  }
  async addDeliverable(projectId, actor, input) {
    object(input, ["body", "taskId", "issueId", "commit", "title", "reviewerId", "supersedesId", "previousRevision", "requestId", "issueRevision"]);
    const issueId = input.issueId ? identifier(input.issueId, "事项") : null;
    const data = { body: text(input.body, "交付内容", 60000, { required: true }), taskId: input.taskId ? identifier(input.taskId, "开发任务") : null,
      commit: input.commit ? text(input.commit, "提交信息", 2000) : null };
    if (!issueId && !data.taskId) throw accountError("请选择交付事项或本人独立开发任务。", 400);
    return this.mutate(projectId, actor, ["deliverable.create", ...(data.taskId ? ["session.view"] : [])], async () => {
      const requestId = input.requestId ? identifier(input.requestId, "提交标识") : undefined;
      const existing = await this.store.deliveryRequest(requestId);
      if (existing) {
        if (existing.projectId !== projectId || existing.authorId !== actor.id || existing.issueId !== issueId || existing.taskId !== data.taskId || existing.body !== data.body || !issueId && input.title !== undefined && existing.title !== text(input.title, "交付标题", 200, { required: true }) || !issueId && input.reviewerId !== undefined && existing.reviewerId !== input.reviewerId || existing.commit !== data.commit || existing.supersedesId !== (input.supersedesId || null)) throw accountError("相同提交标识不能更改交付内容。", 409);
        return presentDeliverable(existing);
      }
      if (requestId) data.requestId = requestId;
      const issue = issueId ? await this.store.issue(projectId, issueId) : null;
      if (issue) assertIssueWritable(issue);
      if (issue?.developmentClaim && data.taskId !== issue.developmentClaim.task.id) throw accountError("送验必须关联当前开发任务。", 409);
      const task = await this.store.deliveryTask(projectId, issueId, actor.id, { ...data, supersedesId: input.supersedesId });
      if (input.supersedesId) {
        const previous = await this.store.readDeliverable(projectId, identifier(input.supersedesId, "退回交付"));
        revision(input.previousRevision);
        const manualHandoff = !previous.taskId && issue?.actions[0]?.explicitHandler && currentHandler(issue) === actor.id;
        if (previous.authorId !== actor.id && !manualHandoff) throw accountError("只有原发布人或明确接手人工返工的处理人能重新提交交付。", 403);
        if (previous.status !== "returned" || previous.next || previous.revision !== input.previousRevision) throw accountError("此交付不可重新提交，请刷新。", 409);
        if (previous.issueId !== issueId) throw accountError("重新提交不能改变交付事项。", 400);
        if (previous.taskId !== data.taskId) {
          const priorTask = previous.taskId ? await this.development.task(projectId, previous.taskId) : null;
          const claim = issueId ? (await this.store.issue(projectId, issueId)).developmentClaim : null;
          if (previous.taskId && (!priorTask || !["cancelled", "completed"].includes(priorTask.status)) || !task || claim?.task.id !== task.id) throw accountError("请先明确认领新的返工任务，再关联原退回交付。", 409);
        }
        data.supersedesId = previous.id;
      }
      if (issue && input.issueRevision !== undefined && issue.revision !== revision(input.issueRevision)) throw accountError("事项已变化，请刷新后重新提交。", 409);
      const submission = issue ? workflowEventEdge(issue, "delivery.submitted") : null;
      const reviewer = issue ? deliveryReviewer(issue, submission) : input.reviewerId;
      if (!reviewer) throw accountError(issue ? "事项未设置流程要求的验证人，请先补充负责人。" : "请选择交付验证人。", 409);
      data.reviewerId = identifier(reviewer, "交付验证人");
      await this.store.members(projectId, [data.reviewerId]);
      await this.projects.authorize(projectId, { id: data.reviewerId }, "deliverable.review");
      const title = text(issue?.title ?? input.title ?? task?.snapshot.title, "交付标题", 200, { required: true });
      if (issue) {
        const previous = await this.store.latestDelivery(projectId, issueId);
        if (previous?.status === "pending") throw accountError("本事项已有待验证交付，请先处理该交付。", 409);
        if (previous?.status === "returned" && data.supersedesId !== previous.id) throw accountError("请沿原退回交付重新提交。", 409);
        if (submission.actor === "developer" && (!data.taskId || issue.developmentClaim?.task.id !== data.taskId || issue.developmentClaim.task.executorId !== actor.id)) throw accountError("送验必须关联本人当前开发任务。", 409);
      }
      if (task && task.status !== "completed" && (task.status !== "planned" || task.runKey)) {
        const execution = await this.development.execution(task);
        if (!["completed", "failed", "interrupted", "cancelled"].includes(execution?.status)) throw accountError("执行仍在进行或结果未知，请先核对开发结果。", 409);
      }
      const delivery = await this.store.deliverable(projectId, issueId, actor.id, { ...data, title, checklist: deliveryChecklist(issue) });
      if (issue) {
        const next = await this.workflow.event(issue, actor, "delivery.submitted", { delivery, reviewerId: data.reviewerId, executorId: task?.executorId, submissionSource: task ? task.runKey ? "agent" : "existing" : "manual" });
        await this.store.bindDeliveryAction(delivery.id, next.actions[0]?.id || null);
      }
      return presentDeliverable(await this.store.readDeliverable(projectId, delivery.id));
    });
  }
  async readDeliverable(projectId, id, actor) {
    return this.read(projectId, actor, ["collaboration.view", "issue.view"], async () => {
      const delivery = await this.store.readDeliverable(projectId, id);
      const issue = delivery.issueId ? await this.store.issue(projectId, delivery.issueId) : null;
      const context = await this.projects.authorize(projectId, actor, "collaboration.view");
      let developmentTask = null;
      if (delivery.taskId && delivery.authorId === actor.id && delivery.status === "returned" && !delivery.next && ["session.view", "issue.view"].every(permission => context.permissions.includes(permission))) {
        const task = await this.development.task(projectId, issue?.developmentClaim?.task.id || delivery.taskId);
        if (task.executorId === actor.id) developmentTask = presentDevelopment(task, actor.id, await this.development.execution(task), { permissions: context.permissions, projectStatus: context.project.status });
      }
      return { delivery: presentDeliverable(delivery), developmentTask, issue: issue ? { ...presentIssue(issue, actor.id, context.permissions), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, issue.id), issue.source) } : null, canReview: delivery.reviewerId === actor.id, canResubmit: (delivery.authorId === actor.id || !delivery.taskId && issue?.actions[0]?.explicitHandler && currentHandler(issue) === actor.id) && delivery.status === "returned" && !delivery.next, permissions: context.project.status === "archived" ? context.permissions.filter(p => p.endsWith(".view")) : context.permissions, people: await this.store.people([delivery.authorId, delivery.reviewerId, delivery.reviewedById, issue?.businessOwnerId]) };
    });
  }
  async beginDelivery(projectId, id, actor, input) {
    object(input, ["revision"]); revision(input.revision);
    return this.mutate(projectId, actor, ["collaboration.view", "deliverable.review"], async () => {
      const delivery = await this.store.readDeliverable(projectId, id);
      if (delivery.issueId) assertIssueWritable(await this.store.issue(projectId, delivery.issueId));
      if (delivery.reviewerId !== actor.id) throw accountError("此交付未分派给你验证。", 403);
      const issue = await this.workflow.assertCurrentDelivery(delivery);
      const saved = await this.store.beginDelivery(projectId, id, actor.id, input.revision);
      if (issue) {
        const next = await this.workflow.event(issue, actor, "verification.started", { delivery: saved, reviewerId: actor.id });
        await this.store.bindDeliveryAction(id, next.actions[0]?.id || null);
      }
      return presentDeliverable(await this.store.readDeliverable(projectId, id));
    });
  }
  async reassignDelivery(projectId, id, actor, input) {
    object(input, ["revision", "reviewerId"]); revision(input.revision);
    const reviewerId = identifier(input.reviewerId, "交付验证人");
    return this.mutate(projectId, actor, ["collaboration.view", "issue.assign"], async () => {
      const delivery = await this.store.readDeliverable(projectId, id);
      if (delivery.issueId) assertIssueWritable(await this.store.issue(projectId, delivery.issueId));
      await this.store.members(projectId, [reviewerId]);
      await this.projects.authorize(projectId, { id: reviewerId }, "deliverable.review");
      const issue = await this.workflow.assertCurrentDelivery(delivery);
      await this.store.reassignDelivery(projectId, id, actor.id, input.revision, reviewerId);
      if (issue) {
        const { permissions } = await this.projects.authorize(projectId, { id: reviewerId }, "issue.view");
        if (!canProcessWorkflowStep(issue, issueWorkflowNode(issue), permissions)) throw accountError("验证人没有当前步骤的操作权限。", 403);
        const next = await this.store.updateIssue(projectId, issue.id, actor.id, issue.revision, {}, "step.assigned", { handlerId: reviewerId, explicitHandler: true });
        await this.store.bindDeliveryAction(id, next.actions[0]?.id || null);
      }
      return presentDeliverable(await this.store.readDeliverable(projectId, id));
    });
  }
  async reviewDeliverable(projectId, id, actor, input) {
    return this.mutate(projectId, actor, ["collaboration.view", "deliverable.review"], async () => {
      const current = await this.store.readDeliverable(projectId, id);
      if (current.reviewerId !== actor.id) throw accountError("只有指定验证人能验收此交付。", 403);
      const issue = await this.workflow.assertCurrentDelivery(current);
      const review = deliveryReview(input, current, issue);
      const saved = await this.store.reviewDeliverable(projectId, id, actor.id, input.revision, review);
      if (issue) await this.workflow.event(issue, actor, "verification." + review.status, { delivery: saved, reviewerId: actor.id, reason: review.reviewNote });
      if (saved.taskId) await this.executionWorkflow.settle(saved.taskId);
      return presentDeliverable(saved);
    });
  }
  async listAssets(projectId, actor, input) {
    const page = pageInput(input);
    if (input.type) page.type = choice(input.type, ASSET_TYPES, "资产类型");
    return this.read(projectId, actor, ["asset.view"], async () => presentPage(await this.store.assets(projectId, page), presentAsset));
  }
  async readAsset(projectId, id, actor) {
    return this.read(projectId, actor, ["asset.view"], async () => {
      const asset = await this.store.asset(projectId, id);
      return { ...presentAsset(asset), people: await this.store.people([asset.ownerId, asset.createdById, asset.updatedById]) };
    });
  }
  async saveAsset(projectId, id, actor, input) {
    const permissions = ["asset.edit", ...(Object.hasOwn(input || {}, "secret") ? ["asset.secret.edit"] : [])];
    return this.mutate(projectId, actor, permissions, async () => {
      const current = id ? await this.store.asset(projectId, id) : null;
      const data = assetInput(input, current);
      if (current && current.revision !== input.revision) throw accountError("资料已被其他人修改，请刷新后重试。", 409);
      await this.store.members(projectId, [data.ownerId]);
      const saved = await this.store.saveAsset(projectId, actor.id, data, current);
      await this.store.audit(actor.id, Object.hasOwn(data, "secret") ? "asset.secret.updated" : "asset.updated", projectId, saved.id);
      return presentAsset(saved);
    });
  }
  async assetHistory(projectId, id, actor, input) {
    return this.read(projectId, actor, ["asset.view"], async () => {
      const page = await this.store.assetHistory(projectId, id, pageInput(input));
      return { ...presentPage(page), people: await this.store.people(page.items.flatMap(row => [row.actorId, row.data?.ownerId])) };
    });
  }
  async readSecret(projectId, id, actor) {
    return this.mutate(projectId, actor, ["asset.secret.view"], async () => {
      const secret = await this.store.secret(projectId, id);
      await this.store.audit(actor.id, "asset.secret.viewed", projectId, id);
      return { secret };
    });
  }
  async listFiles(projectId, resource, id, actor, input) {
    return this.read(projectId, actor, [resource === "issues" ? "issue.view" : "asset.view"], async () => {
      await (resource === "issues" ? this.store.issue(projectId, id) : this.store.asset(projectId, id));
      return presentPage(await this.store.files(projectId, resource, id, pageInput(input)), presentProjectFile);
    });
  }
  async uploadFile(projectId, resource, id, actor, input) {
    const file = projectFileInput(input);
    return this.mutate(projectId, actor, [resource === "issues" ? "issue.edit" : "asset.edit"], async () => {
      await (resource === "issues" ? this.store.issue(projectId, id) : this.store.asset(projectId, id));
      return presentProjectFile(await this.store.addFile(projectId, resource, id, actor.id, file));
    });
  }
  async downloadFile(projectId, id, actor) {
    await this.authorized(projectId, actor, ["project.view"]);
    const metadata = await this.store.file(projectId, id);
    const permission = metadata.issueId ? "issue.view" : "asset.view";
    return this.read(projectId, actor, [permission], async () => {
      const file = await this.store.file(projectId, id, true);
      return { ...file, previewMimeType: previewMimeType(file.data) };
    });
  }
}

module.exports = { ProjectContentServices };
