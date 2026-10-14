const { issueAttachments, projectFileInput, previewMimeType } = require("../domain/project-files.cjs");
const { ProjectContentStore } = require("../storage/project-content-store.cjs");
const { issueRequestId, issueInput, issueTransition, pageInput, text, object, identifier, choice, ISSUE_TYPES, contentFields, assignmentFields } = require("../domain/project-issues.cjs");
const { assetInput, ASSET_TYPES } = require("../domain/project-assets.cjs");
const { accountError } = require("../domain/account.cjs");
const { deliveryChecklist, deliveryReview } = require("../domain/deliverable-review.cjs");
const { presentIssueImages, presentIssue, presentAsset, presentProjectFile, presentPage, presentDeliverable } = require("./project-content-presenter.cjs");

class ProjectContentServices {
  constructor(database, projects) {
    this.store = new ProjectContentStore(database);
    this.projects = projects;
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
      return { ...presentPage(result, presentIssue), people: await this.store.people(result.items.map(issue => issue.assigneeId)) };
    });
  }
  async readIssue(projectId, id, actor) {
    return this.read(projectId, actor, ["issue.view"], async () => {
      const issue = await this.store.issue(projectId, id);
      return { ...presentIssue(issue), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, id), issue.source), people: await this.store.people([issue.createdById, issue.updatedById, issue.assigneeId, ...issue.participantIds]) };
    });
  }
  async createIssue(projectId, actor, input) {
    const data = issueInput(input);
    const requestId = issueRequestId(input);
    const attachments = issueAttachments(input);
    const permissions = ["issue.create", ...(data.participantIds.length ? ["issue.assign"] : [])];
    return this.mutate(projectId, actor, permissions, async () => {
      await this.store.members(projectId, data.participantIds);
      const issue = await this.store.createIssue(projectId, actor.id, data, { requestId, attachments });
      for (const file of attachments) await this.store.addFile(projectId, "issues", issue.id, actor.id, file);
      return { ...presentIssue(issue), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, issue.id), issue.source) };
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
      await this.store.members(projectId, data.participantIds || []);
      const issue = await this.store.updateIssue(projectId, id, actor.id, input.revision, data);
      for (const file of attachments) await this.store.addFile(projectId, "issues", id, actor.id, file);
      return { ...presentIssue(issue), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, issue.id), issue.source) };
    });
  }
  async transitionIssue(projectId, id, actor, input) {
    await this.authorized(projectId, actor, ["issue.view"]);
    return this.store.transaction(async () => {
      const current = await this.store.issue(projectId, id);
      const transition = issueTransition(current, input);
      await this.authorized(projectId, actor, [transition.permission]);
      const result = await this.store.updateIssue(projectId, id, actor.id, input.revision, { status: transition.status }, "transition", { reason: transition.reason });
      await this.authorized(projectId, actor, [transition.permission]);
      return { ...presentIssue(result), images: presentIssueImages(await this.store.issuePreviewFiles(projectId, id), result.source) };
    });
  }
  async children(projectId, id, actor, kind, input) {
    return this.read(projectId, actor, [kind === "history" ? "issue.view" : "collaboration.view"], async () => {
      const page = await this.store.childList(kind, projectId, id, pageInput(input));
      const people = page.items.flatMap(row => [row.authorId || row.actorId,
        ...[row.data?.before, row.data?.after].flatMap(snapshot => [snapshot?.assigneeId, ...(snapshot?.participantIds || [])])]);
      return { ...presentPage(page, kind === "deliverables" ? presentDeliverable : undefined), people: await this.store.people(people) };
    });
  }
  async addComment(projectId, id, actor, input) {
    object(input, ["body"]);
    const body = text(input.body, "评论", 60000, { required: true });
    return this.mutate(projectId, actor, ["comment.create"], async () => (await this.store.comment(projectId, id, actor.id, body)));
  }
  async addDeliverable(projectId, actor, input) {
    object(input, ["body", "taskId", "issueId", "commit", "title"]);
    const issueId = input.issueId ? identifier(input.issueId, "事项") : null;
    const data = { body: text(input.body, "交付内容", 60000, { required: true }), taskId: input.taskId ? identifier(input.taskId, "开发任务") : null,
      commit: input.commit ? text(input.commit, "提交信息", 2000) : null };
    if (!issueId && !data.taskId) throw accountError("请选择交付事项或本人独立开发任务。", 400);
    return this.mutate(projectId, actor, ["deliverable.create", ...(data.taskId ? ["session.view"] : [])], async () => {
      const issue = issueId ? await this.store.issue(projectId, issueId) : null;
      const title = text(input.title ?? issue?.title, "交付标题", 200, { required: true });
      return presentDeliverable(await this.store.deliverable(projectId, issueId, actor.id, { ...data, title, checklist: deliveryChecklist(issue) }));
    });
  }
  async readDeliverable(projectId, id, actor) {
    return this.read(projectId, actor, ["collaboration.view", "issue.view"], async () => {
      const delivery = await this.store.readDeliverable(projectId, id);
      const issue = delivery.issueId ? await this.store.issue(projectId, delivery.issueId) : null;
      const context = await this.projects.authorize(projectId, actor, "collaboration.view");
      return { delivery: presentDeliverable(delivery), issue: issue ? presentIssue(issue) : null, permissions: context.project.status === "archived" ? context.permissions.filter(p => p.endsWith(".view")) : context.permissions, people: await this.store.people([delivery.authorId, delivery.reviewedById]) };
    });
  }
  async reviewDeliverable(projectId, id, actor, input) {
    return this.mutate(projectId, actor, ["collaboration.view", "deliverable.review"], async () => {
      const current = await this.store.readDeliverable(projectId, id);
      const review = deliveryReview(input, current);
      if (input.transitionId) {
        if (!current.issueId) throw accountError("独立开发交付没有可流转的事项。", 400);
        const issue = await this.store.issue(projectId, current.issueId);
        const transition = issueTransition(issue, { transitionId: input.transitionId, revision: input.issueRevision, reason: review.reviewNote });
        await this.authorized(projectId, actor, [transition.permission]);
        await this.store.updateIssue(projectId, issue.id, actor.id, input.issueRevision, { status: transition.status }, "transition", { reason: transition.reason });
      }
      return presentDeliverable(await this.store.reviewDeliverable(projectId, id, actor.id, input.revision, review));
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
