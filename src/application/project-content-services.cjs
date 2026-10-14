const { issueAttachments, projectFileInput, previewMimeType } = require("../domain/project-files.cjs");
const { ProjectContentStore } = require("../storage/project-content-store.cjs");
const { issueRequestId, issueInput, issueTransition, pageInput, text, object, identifier, choice, ISSUE_TYPES, contentFields, assignmentFields } = require("../domain/project-issues.cjs");
const { assetInput, ASSET_TYPES } = require("../domain/project-assets.cjs");
const { accountError } = require("../domain/account.cjs");
const { deliveryChecklist, deliveryReview } = require("../domain/deliverable-review.cjs");
const { responsibilityFields, revision } = require("../domain/project-issues.cjs");
const { issueWorkflowNode, assertIssueWritable } = require("../domain/issue-workflows.cjs");
const { workflowHandler, canProcessWorkflowStep, assertWorkflowHandler, assertTransitionFields } = require("../domain/workflow-actions.cjs");
const { WorkActionStore } = require("../storage/work-action-store.cjs");
const { presentIssueImages, presentIssue, presentAsset, presentProjectFile, presentPage, presentDeliverable } = require("./project-content-presenter.cjs");

class ProjectContentServices {
  constructor(database, projects) {
    this.store = new ProjectContentStore(database);
    this.projects = projects;
    this.actions = new WorkActionStore(database);
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
    const page = pageInput(input);
    if (input.type) page.type = choice(input.type, ISSUE_TYPES, "事项类型");
    if (input.releaseId !== undefined) page.releaseId = ["none", "unassigned"].includes(input.releaseId) ? null : identifier(input.releaseId, "发布版本");
    page.includeArchived = input.includeArchived === "true" || input.includeArchived === "1";
    if (input.status) page.status = text(input.status, "状态", 100);
    return this.read(projectId, actor, ["issue.view"], async () => {
      const result = await this.store.issues(projectId, page);
      return { ...presentPage(result, row => presentIssue(row, actor.id)), people: await this.store.people(result.items.flatMap(issue => [issue.developerId, ...responsibilityFields.map(field => issue[field])])) };
    });
  }
  async reviewers(projectId, actor) {
    return this.read(projectId, actor, ["collaboration.view"], async () => {
      const items = [];
      for (const candidate of await this.store.memberCandidates(projectId)) {
        try { await this.projects.authorize(projectId, candidate, "deliverable.review"); items.push(candidate); }
        catch (error) { if (![401, 403, 404, 409].includes(error.statusCode)) throw error; }
      }
      return { items };
    });
  }
  async readIssue(projectId, id, actor) {
    return this.read(projectId, actor, ["issue.view"], async () => {
      const issue = await this.store.issue(projectId, id);
      return { ...presentIssue(issue, actor.id), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, id), issue.source), people: await this.store.people([issue.createdById, issue.updatedById, issue.developerId, ...responsibilityFields.map(field => issue[field]), ...issue.watcherIds]) };
    });
  }
  async createIssue(projectId, actor, input) {
    const data = issueInput(input);
    data.reporterId ??= actor.id;
    data.businessOwnerId ??= actor.id;
    const requestId = issueRequestId(input);
    const attachments = issueAttachments(input);
    const permissions = ["issue.create", ...(data.watcherIds.length || responsibilityFields.some(field => data[field] && data[field] !== actor.id) ? ["issue.assign"] : [])];
    return this.mutate(projectId, actor, permissions, async () => {
      await this.store.members(projectId, [...data.watcherIds, ...responsibilityFields.map(field => data[field])]);
      const issue = await this.store.createIssue(projectId, actor.id, data, { requestId, attachments });
      for (const file of attachments) await this.store.addFile(projectId, "issues", issue.id, actor.id, file);
      return { ...presentIssue(issue, actor.id), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, issue.id), issue.source) };
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
      return { ...presentIssue(issue, actor.id), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, issue.id), issue.source) };
    });
  }
  async transitionIssue(projectId, id, actor, input) {
    await this.authorized(projectId, actor, ["issue.view"]);
    return this.store.transaction(async () => {
      const current = await this.store.issue(projectId, id);
      const transition = await this.validateTransition(current, actor, input);
      const result = await this.store.updateIssue(projectId, id, actor.id, input.revision, { status: transition.status }, "transition", { reason: transition.reason });
      await this.authorized(projectId, actor, [transition.permission]);
      return { ...presentIssue(result, actor.id), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, id), result.source) };
    });
  }
  async validateTransition(issue, actor, input) {
    const transition = issueTransition(issue, input);
    assertWorkflowHandler(issue, issueWorkflowNode(issue), actor.id);
    const edge = issue.workflowVersion.definition.transitions.find(edge => edge.id === input.transitionId || (!input.transitionId && edge.from === issue.status && edge.to === input.status));
    assertTransitionFields(issue, edge);
    if (edge.requireAcceptedDelivery && !await this.store.hasAcceptedDelivery(issue.projectId, issue.id)) throw accountError("需要先通过最新交付的验收。", 409);
    const next = issue.workflowVersion.definition.nodes.find(node => node.id === transition.status);
    if (!["completed", "cancelled"].includes(next.kind)) {
      const handlerId = workflowHandler(issue, next);
      if (!handlerId) throw accountError("下一步骤尚未指定处理人，请先填写对应职责成员。", 409);
      await this.store.members(issue.projectId, [handlerId]);
      await this.authorizeStep(issue, next, { id: handlerId });
    }
    await this.authorized(issue.projectId, actor, ["issue.view", transition.permission]);
    return transition;
  }
  async authorizeStep(issue, node, actor) {
    const { permissions } = await this.projects.authorize(issue.projectId, actor, "issue.view");
    if (!canProcessWorkflowStep(issue, node, permissions)) throw accountError("处理人没有当前步骤配置的操作权限。", 403);
  }
  async startIssueStep(projectId, id, actor, input) {
    object(input, ["revision", "actionRevision"]); revision(input.revision); revision(input.actionRevision);
    return this.mutate(projectId, actor, ["issue.view"], async () => {
      const issue = await this.store.issue(projectId, id);
      assertIssueWritable(issue);
      assertWorkflowHandler(issue, issueWorkflowNode(issue), actor.id);
      if (issue.revision !== input.revision) throw accountError("事项已变化，请刷新。", 409);
      await this.authorizeStep(issue, issueWorkflowNode(issue), actor);
      await this.actions.start(issue, actor.id, input.actionRevision);
      return presentIssue(await this.store.issue(projectId, id), actor.id);
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
  async addDeliverable(projectId, actor, input) {
    object(input, ["body", "taskId", "issueId", "commit", "title", "reviewerId", "supersedesId", "previousRevision"]);
    const issueId = input.issueId ? identifier(input.issueId, "事项") : null;
    const data = { body: text(input.body, "交付内容", 60000, { required: true }), taskId: input.taskId ? identifier(input.taskId, "开发任务") : null,
      commit: input.commit ? text(input.commit, "提交信息", 2000) : null };
    if (!issueId && !data.taskId) throw accountError("请选择交付事项或本人独立开发任务。", 400);
    return this.mutate(projectId, actor, ["deliverable.create", ...(data.taskId ? ["session.view"] : [])], async () => {
      if (input.supersedesId) {
        const previous = await this.store.readDeliverable(projectId, identifier(input.supersedesId, "退回交付"));
        revision(input.previousRevision);
        if (previous.authorId !== actor.id) throw accountError("只有原发布人能重新提交交付。", 403);
        if (previous.status !== "returned" || previous.next || previous.revision !== input.previousRevision) throw accountError("此交付不可重新提交，请刷新。", 409);
        if (previous.issueId !== issueId || previous.taskId !== data.taskId) throw accountError("重新提交不能改变交付来源。", 400);
        data.supersedesId = previous.id;
      }
      const issue = issueId ? await this.store.issue(projectId, issueId) : null;
      data.reviewerId = identifier(input.reviewerId || issue?.qaOwnerId || issue?.acceptanceOwnerId, "交付验证人");
      await this.store.members(projectId, [data.reviewerId]);
      await this.projects.authorize(projectId, { id: data.reviewerId }, "deliverable.review");
      const title = text(input.title ?? issue?.title, "交付标题", 200, { required: true });
      return presentDeliverable(await this.store.deliverable(projectId, issueId, actor.id, { ...data, title, checklist: deliveryChecklist(issue) }));
    });
  }
  async readDeliverable(projectId, id, actor) {
    return this.read(projectId, actor, ["collaboration.view", "issue.view"], async () => {
      const delivery = await this.store.readDeliverable(projectId, id);
      const issue = delivery.issueId ? await this.store.issue(projectId, delivery.issueId) : null;
      const context = await this.projects.authorize(projectId, actor, "collaboration.view");
      return { delivery: presentDeliverable(delivery), issue: issue ? presentIssue(issue, actor.id) : null, canReview: delivery.reviewerId === actor.id, canResubmit: delivery.authorId === actor.id && delivery.status === "returned" && !delivery.next, permissions: context.project.status === "archived" ? context.permissions.filter(p => p.endsWith(".view")) : context.permissions, people: await this.store.people([delivery.authorId, delivery.reviewerId, delivery.reviewedById]) };
    });
  }
  async beginDelivery(projectId, id, actor, input) {
    object(input, ["revision"]); revision(input.revision);
    return this.mutate(projectId, actor, ["collaboration.view", "deliverable.review"], async () => {
      const delivery = await this.store.readDeliverable(projectId, id);
      if (delivery.issueId) assertIssueWritable(await this.store.issue(projectId, delivery.issueId));
      if (delivery.reviewerId !== actor.id) throw accountError("此交付未分派给你验证。", 403);
      return presentDeliverable(await this.store.beginDelivery(projectId, id, actor.id, input.revision));
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
      return presentDeliverable(await this.store.reassignDelivery(projectId, id, actor.id, input.revision, reviewerId));
    });
  }
  async reviewDeliverable(projectId, id, actor, input) {
    return this.mutate(projectId, actor, ["collaboration.view", "deliverable.review"], async () => {
      const current = await this.store.readDeliverable(projectId, id);
      if (current.reviewerId !== actor.id) throw accountError("只有指定验证人能验收此交付。", 403);
      const review = deliveryReview(input, current);
      const saved = await this.store.reviewDeliverable(projectId, id, actor.id, input.revision, review);
      if (input.transitionId) {
        if (!current.issueId) throw accountError("独立开发交付没有可流转的事项。", 400);
        const issue = await this.store.issue(projectId, current.issueId);
        const transition = await this.validateTransition(issue, actor, { transitionId: input.transitionId, revision: input.issueRevision, reason: review.reviewNote });
        const target = issue.workflowVersion.definition.nodes.find(node => node.id === transition.status);
        if ((review.status === "returned" && ["completed", "cancelled"].includes(target.kind)) || (review.status === "accepted" && target.kind === "cancelled")) throw accountError("验收结论与事项流转目标不一致。", 400);
        await this.store.updateIssue(projectId, issue.id, actor.id, input.issueRevision, { status: transition.status }, "transition", { reason: transition.reason });
      }
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
