const { installReviewWorkflow } = require("../support/workflow-fixture.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");
const { randomUUID } = require("node:crypto");
const { ProjectDevelopmentServices } = require("../../src/application/project-development-services.cjs");
const { ProjectLifecycleStore } = require("../../src/storage/project-lifecycle-store.cjs");
const { WorkbenchStore } = require("../../src/storage/workbench-store.cjs");
const { WorkActionQueryStore } = require("../../src/storage/work-action-query-store.cjs");

async function fixture(t) {
  const database = await initializeTestDatabase(t, temporary(t));
  const permissions = projectPermissionCatalog.filter(entry => entry.scope === "project").map(entry => entry.id);
  const department = await database.client.department.create({ data: { name: "协作测试", permissions } });
  const actor = await database.client.user.create({ data: { username: "content-owner", displayName: "content-owner", passwordHash: "not-used", role: "member", departmentId: department.id } });
  const outsider = await database.client.user.create({ data: { username: "content-outsider", displayName: "content-outsider", passwordHash: "not-used", role: "member", departmentId: department.id } });
  const project = await database.client.project.create({ data: { name: "项目甲", directoryName: "repo", directoryKey: "repo", ownerUserId: actor.id, remoteUrl: "https://example.test/team/repo.git" } });
  const other = await database.client.project.create({ data: { name: "项目乙", directoryName: "repo-other", directoryKey: "repo-other", ownerUserId: actor.id, remoteUrl: "https://example.test/team/repo.git" } });
  for (const selected of [project, other]) await database.client.projectMember.create({ data: { projectId: selected.id, userId: actor.id, permissions } });
  const projects = new ProjectServices(database);
  const services = new ProjectContentServices(database, projects);
  const setPermissions = value => database.client.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: actor.id } }, data: { permissions: value } });
  return { database, permissions, actor, outsider, project, other, projects, services, setPermissions };
}

test("deleting unlinked requirements and bugs hides all public content and preserves identities and audit", async t => {
  const { database, actor, project, services, projects } = await fixture(t);
  const lifecycle = new ProjectLifecycleStore(database), workbench = new WorkbenchStore(database);
  const release = await database.client.projectRelease.create({ data: { projectId: project.id, name: "v-delete" } });
  for (const type of ["requirement", "bug"]) {
    const input = { requestId: randomUUID(), type, title: `无效${type}`, releaseId: release.id, businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id };
    const issue = await services.createIssue(project.id, actor, input);
    assert.equal(issue.deletion.allowed, true);
    const file = await services.uploadFile(project.id, "issues", issue.id, actor, { name: "notes.txt", mimeType: "text/plain", data: Buffer.from("context") });
    await services.addComment(project.id, issue.id, actor, { body: "信息不明确" });
    const source = await database.client.issueSource.create({ data: { projectId: project.id, issueId: issue.id, channel: "manual", scope: "test", type, externalId: issue.id, snapshot: { title: issue.title } } });
    const asset = await services.saveAsset(project.id, null, actor, { type: "note", title: "共享参考", issueIds: [issue.id] });
    assert.deepEqual(await services.deleteIssue(project.id, issue.id, actor, { revision: issue.revision }), { id: issue.id, deleted: true });
    for (const operation of [
      () => services.readIssue(project.id, issue.id, actor),
      () => services.children(project.id, issue.id, actor, "history", {}),
      () => services.children(project.id, issue.id, actor, "comments", {}),
      () => services.listFiles(project.id, "issues", issue.id, actor, {}),
      () => services.downloadFile(project.id, file.id, actor),
      () => services.updateIssue(project.id, issue.id, actor, { revision: issue.revision, title: "复活" }),
      () => services.addComment(project.id, issue.id, actor, { body: "迟到回复" }),
      () => new ProjectDevelopmentServices(database, projects).create(project.id, actor, { requestId: randomUUID(), issueIds: [issue.id] }),
    ]) await assert.rejects(operation, { statusCode: 404 });
    await assert.rejects(services.createIssue(project.id, actor, input), /已删除/);
    assert.deepEqual((await services.listIssues(project.id, actor, { includeArchived: "true" })).items, []);
    assert.equal((await workbench.list("issues", [project.id], actor.id, { limit: 30, offset: 0 })).total, 0);
    assert.deepEqual((await workbench.activity(project.id, { deliveries: true })).items, []);
    assert.equal((await projects.list(actor)).projects.find(row => row.id === project.id).issueCount, 0);
    assert.equal((await lifecycle.releases(project.id, true))[0].progress.total, 0);
    assert.deepEqual((await new WorkActionQueryStore(database).snapshot([project.id], actor.id)).actions, []);
    assert.deepEqual((await services.readAsset(project.id, asset.id, actor)).issueIds, []);
    await services.saveAsset(project.id, asset.id, actor, { revision: asset.revision, title: "仍可编辑资产", issueIds: [] });
    const stored = await database.client.projectIssue.findUnique({ where: { id: issue.id } });
    assert.ok(stored.deletedAt);
    assert.equal(stored.number, issue.number);
    assert.equal(stored.revision, issue.revision + 1);
    assert.deepEqual(await database.client.issueSource.findUnique({ where: { issueId: issue.id } }), source);
    assert.ok(await database.client.projectFile.findUnique({ where: { id: file.id } }));
    assert.equal(await database.client.issueComment.count({ where: { issueId: issue.id } }), 1);
    const history = await database.client.issueHistory.findFirst({ where: { issueId: issue.id, action: "deleted" } });
    assert.equal(history.actorId, actor.id);
    assert.ok(await database.client.auditEvent.findFirst({ where: { actorUserId: actor.id, event: "issue.deleted", details: { path: ["resourceId"], equals: issue.id } } }));
  }
  await lifecycle.transaction(() => lifecycle.archiveRelease(project.id, release.id, release.revision, true));
  assert.equal((await services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: "requirement", title: "下一条" })).number, 3);
});

test("issue deletion checks independent permissions, project scope, archive and the confirmed revision", async t => {
  const { database, actor, outsider, project, other, services, permissions, setPermissions } = await fixture(t);
  const issue = await services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: "bug", title: "删除权限测试" });
  await assert.rejects(services.deleteIssue(project.id, issue.id, outsider, { revision: 1 }), { statusCode: 404 });
  await assert.rejects(services.deleteIssue(other.id, issue.id, actor, { revision: 1 }), { statusCode: 404 });
  await setPermissions(permissions.filter(p => p !== "issue.delete"));
  assert.equal((await services.readIssue(project.id, issue.id, actor)).deletion.allowed, false);
  await assert.rejects(services.deleteIssue(project.id, issue.id, actor, { revision: 1 }), { statusCode: 403 });
  await setPermissions(permissions);
  await assert.rejects(services.deleteIssue(project.id, issue.id, actor, {}), { statusCode: 400 });
  await services.updateIssue(project.id, issue.id, actor, { revision: 1, title: "他人已修改" });
  await assert.rejects(services.deleteIssue(project.id, issue.id, actor, { revision: 1 }), { statusCode: 409 });
  const release = await database.client.projectRelease.create({ data: { projectId: project.id, name: "archived", status: "archived" } });
  await database.client.projectIssue.update({ where: { id: issue.id }, data: { releaseId: release.id } });
  await assert.rejects(services.deleteIssue(project.id, issue.id, actor, { revision: 2 }), /归档/);
  await database.client.projectIssue.update({ where: { id: issue.id }, data: { releaseId: null } });
  await database.client.project.update({ where: { id: project.id }, data: { status: "archived" } });
  await assert.rejects(services.deleteIssue(project.id, issue.id, actor, { revision: 2 }), /归档/);
  assert.equal((await database.client.projectIssue.findUnique({ where: { id: issue.id } })).deletedAt, null);
  assert.equal(await database.client.auditEvent.count({ where: { event: "issue.deleted" } }), 0);
});

test("all development and delivery history blocks issue deletion, including cancelled and accepted records", async t => {
  const { database, actor, project, services, projects } = await fixture(t);
  const development = new ProjectDevelopmentServices(database, projects);
  const issue = await services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: "requirement", title: "已安排开发" });
  const { tasks: [task] } = await development.create(project.id, actor, { requestId: randomUUID(), issueIds: [issue.id] });
  for (const status of ["planned", "cancelled", "completed", "merged"]) {
    await database.client.developmentTask.update({ where: { id: task.id }, data: { status } });
    if (status !== "planned") await database.client.issueDevelopmentClaim.deleteMany({ where: { issueId: issue.id } });
    const current = await services.readIssue(project.id, issue.id, actor);
    assert.equal(current.deletion.allowed, false);
    await assert.rejects(services.deleteIssue(project.id, issue.id, actor, { revision: current.revision }), /关联开发任务或交付/);
  }
  const delivered = await services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: "bug", title: "人工交付历史" });
  await database.client.projectDeliverable.create({ data: { projectId: project.id, issueId: delivered.id, authorId: actor.id, reviewerId: actor.id, body: "成果", status: "accepted" } });
  await assert.rejects(services.deleteIssue(project.id, delivered.id, actor, { revision: 1 }), /关联开发任务或交付/);
  assert.equal(await database.client.projectIssue.count({ where: { deletedAt: { not: null } } }), 0);
});

test("concurrent assignment and deletion cannot leave a task linked to a deleted issue", async t => {
  const { database, actor, project, services, projects } = await fixture(t);
  const issue = await services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: "requirement", title: "并发操作" });
  const results = await Promise.allSettled([
    services.deleteIssue(project.id, issue.id, actor, { revision: 1 }),
    new ProjectDevelopmentServices(database, projects).create(project.id, actor, { requestId: randomUUID(), issueIds: [issue.id] }),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.ok([404, 409].includes(results.find(result => result.status === "rejected").reason.statusCode));
  assert.equal(await database.client.taskIssueLink.count({ where: { issue: { deletedAt: { not: null } } } }), 0);
});

test("historical source snapshots and images survive local requirement and bug edits without source access", async t => {
  const { png } = require("../support/helpers.cjs");
  const { database, actor, project, services } = await fixture(t);
  t.mock.method(globalThis, "fetch", () => assert.fail("history must not contact the retired source"));
  for (const type of ["requirement", "bug"]) {
    const issue = await services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type, title: "历史事项", description: "![历史图片](https://file.tapd.cn/diagram.png)" });
    const file = await services.uploadFile(project.id, "issues", issue.id, actor, { name: "diagram.png", mimeType: "image/png", data: png });
    const source = await database.client.issueSource.create({ data: { projectId: project.id, issueId: issue.id, channel: "tapd", scope: "123", type, externalId: issue.id,
      url: "https://www.tapd.cn/123/story/1", snapshot: { title: "原始内容", projectImages: [{ source: "https://file.tapd.cn/diagram.png", fileId: file.id }] } } });
    const before = await services.readIssue(project.id, issue.id, actor);
    const changed = await services.updateIssue(project.id, issue.id, actor, { revision: before.revision, title: "本地修改" });
    assert.deepEqual(changed.images, before.images);
    assert.ok(changed.images.some(image => image.source === "https://file.tapd.cn/diagram.png" && image.url === file.previewUrl));
    assert.deepEqual(await database.client.issueSource.findUnique({ where: { issueId: issue.id } }), source);
    assert.deepEqual((await services.downloadFile(project.id, file.id, actor)).data, png);
    assert.equal(changed.id, issue.id);
    assert.equal(changed.title, "本地修改");
  }
});

test("project issues enforce membership, assignment, acceptance and revision history without starting execution", async t => {
  const { database, permissions, actor, outsider, project, services, setPermissions } = await fixture(t);
  await installReviewWorkflow(database);
  const issue = await services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, qaOwnerId: actor.id, type: "requirement", title: "可验收需求", watcherIds: [actor.id], acceptanceCriteria: ["可验证"] });
  assert.equal(issue.number, 1);
  assert.equal(issue.status, "draft");
  await assert.rejects(services.readIssue(project.id, issue.id, outsider), { statusCode: 404 });
  await assert.rejects(services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: "bug", title: "缺陷", watcherIds: [outsider.id] }), /有效项目成员/);
  const outcomes = await Promise.allSettled(["甲", "乙"].map(title => services.updateIssue(project.id, issue.id, actor, { title, revision: 1 })));
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(result => result.status === "rejected").reason.statusCode, 409);
  const delivery = await services.addDeliverable(project.id, actor, { issueId: issue.id, body: "完成交付", commit: "abc123" });
  const review = { revision: delivery.revision, status: "accepted", checkedItems: delivery.checklist.map((_, i) => i) };
  await setPermissions(permissions.filter(permission => permission !== "issue.accept"));
  await assert.rejects(services.reviewDeliverable(project.id, delivery.id, actor, review), { statusCode: 403 });
  await setPermissions(permissions);
  await services.reviewDeliverable(project.id, delivery.id, actor, review);
  let current = await services.readIssue(project.id, issue.id, actor);
  assert.equal(current.status, "done");
  await assert.rejects(services.transitionIssue(project.id, issue.id, actor, { status: "draft", revision: current.revision }), /原因/);
  current = await services.transitionIssue(project.id, issue.id, actor, { status: "draft", revision: current.revision, reason: "再次打开" });
  await services.addComment(project.id, issue.id, actor, { body: "评审说明" });
  await assert.rejects(services.addDeliverable(project.id, actor, { issueId: issue.id, body: "非法任务", taskId: "foreign-task" }), { statusCode: 400 });
  assert.equal((await services.children(project.id, issue.id, actor, "comments", {})).items[0].body, "评审说明");
  const history = await services.children(project.id, issue.id, actor, "history", { limit: 2 });
  assert.equal(history.items.length, 2);
  assert.equal(history.nextOffset, 2);
  assert.equal(history.items[0].data.reason, "再次打开");
  assert.equal((await services.listIssues(project.id, actor, { status: "draft", query: current.title })).items.length, 1);
  assert.equal(await database.client.developmentTask.count(), 0);
});

test("project assets encrypt sensitive history, audit reads, enforce independent secret permissions and scope attachments", async t => {
  const { database, permissions, actor, outsider, project, other, services, setPermissions } = await fixture(t);
  const issue = await services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: "bug", title: "登录缺陷" });
  const foreign = await services.createIssue(other.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: "bug", title: "另一项目" });
  const secret = "private-token-should-never-leak";
  const asset = await services.saveAsset(project.id, null, actor, { type: "credential", title: "测试账号", username: "tester", environment: "test", secret, issueIds: [issue.id] });
  assert.equal(asset.hasSecret, true);
  assert.equal(Object.hasOwn(asset, "secret"), false);
  const stored = await database.client.projectAsset.findUnique({ where: { id: asset.id } });
  assert.doesNotMatch(stored.secret, /private-token-should-never-leak/);
  const encryptedHistory = await database.client.assetHistory.findFirst({ where: { assetId: asset.id } });
  assert.doesNotMatch(JSON.stringify(encryptedHistory), /private-token-should-never-leak/);
  assert.equal(Object.hasOwn(encryptedHistory.data, "secret"), false);
  await setPermissions(permissions.filter(permission => !["asset.secret.view", "asset.secret.edit"].includes(permission)));
  assert.equal((await services.readAsset(project.id, asset.id, actor)).hasSecret, true);
  await assert.rejects(services.readSecret(project.id, asset.id, actor), { statusCode: 403 });
  await assert.rejects(services.saveAsset(project.id, asset.id, actor, { revision: 1, secret: "other" }), { statusCode: 403 });
  const renamed = await services.saveAsset(project.id, asset.id, actor, { revision: 1, title: "测试登录" });
  await assert.rejects(services.saveAsset(project.id, asset.id, actor, { revision: renamed.revision, issueIds: [foreign.id] }), /不属于/);
  await setPermissions(permissions);
  assert.deepEqual(await services.readSecret(project.id, asset.id, actor), { secret });
  const history = await services.assetHistory(project.id, asset.id, actor, {});
  assert.doesNotMatch(JSON.stringify(history), /private-token-should-never-leak|"secret"/);
  const audit = await database.client.auditEvent.findMany();
  assert.ok(audit.some(row => row.event === "asset.secret.viewed"));
  assert.doesNotMatch(JSON.stringify(audit), /private-token-should-never-leak/);
  const file = await services.uploadFile(project.id, "assets", asset.id, actor, { name: "说明.txt", mimeType: "text/plain", data: Buffer.from("attachment") });
  assert.equal(Object.hasOwn(file, "data"), false);
  assert.equal((await services.downloadFile(project.id, file.id, actor)).data.toString(), "attachment");
  await assert.rejects(services.downloadFile(other.id, file.id, actor), { statusCode: 404 });
  await assert.rejects(services.downloadFile(project.id, file.id, outsider), { statusCode: 404 });
  await setPermissions(permissions.filter(permission => !permission.startsWith("asset.")));
  await assert.rejects(services.downloadFile(project.id, file.id, actor), { statusCode: 403 });
});

test("issue attachments commit with full bug fields, enforce permissions and roll back conflicts", async t => {
  const { randomUUID } = require('node:crypto');
  const { png } = require('../support/helpers.cjs');
  const { database, permissions, actor, outsider, project, other, services, setPermissions } = await fixture(t);
  const attachment = (data = png) => ({ id: randomUUID(), name: '截图.png', mimeType: 'image/png', data: data.toString('base64') });
  const first = attachment();
  await setPermissions(['project.view', 'issue.view', 'issue.create']);
  const input = { type: 'bug', title: '完整缺陷', businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id, description: `![截图](/api/projects/${project.id}/files/${first.id})`, priority: 'urgent', severity: 'critical', reproductionSteps: '复现步骤', expectedResult: '预期', actualResult: '实际', acceptanceCriteria: ['验收'], attachments: [first] };
  const issue = await services.createIssue(project.id, actor, input);
  for (const key of ['description', 'priority', 'severity', 'reproductionSteps', 'expectedResult', 'actualResult', 'acceptanceCriteria']) assert.deepEqual(issue[key], input[key]);
  await assert.rejects(services.createIssue(project.id, outsider, input), { statusCode: 404 });
  await setPermissions(['project.view', 'issue.view', 'issue.assign']);
  await assert.rejects(services.updateIssue(project.id, issue.id, actor, { revision: 1, attachments: [attachment()] }), { statusCode: 403 });
  await setPermissions(permissions);
  const view = await services.readIssue(project.id, issue.id, actor);
  assert.deepEqual(view.images, [{ source: `/api/projects/${project.id}/files/${first.id}`, url: `/api/projects/${project.id}/files/${first.id}?inline=1` }]);
  const foreign = await services.createIssue(other.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: 'bug', title: '另一项目', attachments: [attachment()] });
  const foreignFile = (await services.listFiles(other.id, 'issues', foreign.id, actor, {})).items[0];
  const fresh = attachment();
  await assert.rejects(services.updateIssue(project.id, issue.id, actor, { revision: 1, title: '不能保存', attachments: [fresh, { ...attachment(), id: foreignFile.id }] }), { statusCode: 409 });
  assert.equal((await services.readIssue(project.id, issue.id, actor)).title, issue.title);
  assert.equal(await database.client.projectFile.count({ where: { id: fresh.id } }), 0);
  assert.equal((await services.downloadFile(other.id, foreignFile.id, actor)).data.equals(png), true);
  const count = await database.client.projectIssue.count();
  await assert.rejects(services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, ...input, attachments: [fresh, first] }), { statusCode: 409 });
  assert.equal(await database.client.projectIssue.count(), count);
  assert.equal(await database.client.projectFile.count({ where: { id: fresh.id } }), 0);
  const changed = await services.updateIssue(project.id, issue.id, actor, { revision: 1, actualResult: '新实际', attachments: [fresh] });
  assert.equal(changed.revision, 2);
  const stale = attachment();
  await assert.rejects(services.updateIssue(project.id, issue.id, actor, { revision: 1, attachments: [stale] }), { statusCode: 409 });
  assert.equal(await database.client.projectFile.count({ where: { id: stale.id } }), 0);
  const fake = await services.uploadFile(project.id, 'issues', issue.id, actor, { name: 'fake.png', mimeType: 'image/png', data: Buffer.from('<svg/>') });
  assert.equal(fake.previewUrl, null);
  assert.equal((await services.downloadFile(project.id, fake.id, actor)).previewMimeType, null);
  assert.equal((await services.readIssue(project.id, issue.id, actor)).images.length, 2);
});


test('issue creation retries preserve identity and initial request, attachment retries preserve stored bytes', async t => {
  const { randomUUID } = require('node:crypto');
  const { database, permissions, actor, outsider, project, other, services } = await fixture(t);
  const file = { id: randomUUID(), name: 'note.txt', mimeType: 'text/plain', data: Buffer.from('original').toString('base64') };
  const input = { requestId: randomUUID(), type: 'bug', title: 'retry', businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id, actualResult: 'original result', attachments: [file] };
  for (const requestId of [null, '', 'not-a-uuid']) await assert.rejects(services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, ...input, requestId }), { statusCode: 400 });
  const original = await services.createIssue(project.id, actor, input);
  assert.equal(original.id, input.requestId);
  const retried = await services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, ...input });
  assert.equal(retried.id, original.id);
  assert.equal(retried.number, original.number);
  assert.equal(await database.client.projectIssue.count(), 1);
  assert.equal(await database.client.issueHistory.count({ where: { issueId: original.id } }), 1);
  assert.equal((await database.client.project.findUnique({ where: { id: project.id } })).issueSequence, 1);
  assert.equal(await database.client.projectFile.count(), 1);
  const changed = await services.updateIssue(project.id, original.id, actor, { revision: 1, title: 'edited since creation', attachments: [file] });
  assert.equal(changed.revision, 2);
  assert.equal((await services.createIssue(project.id, actor, input)).title, changed.title);
  for (const patch of [{ title: 'different' }, { attachments: [] }, { attachments: [{ ...file, name: 'renamed.txt' }] }, { attachments: [{ ...file, data: Buffer.from('changed!').toString('base64') }] }])
    await assert.rejects(services.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, ...input, ...patch }), { statusCode: 409 });
  await assert.rejects(services.createIssue(other.id, actor, input), { statusCode: 409 });
  await database.client.projectMember.create({ data: { projectId: project.id, userId: outsider.id, permissions } });
  await assert.rejects(services.createIssue(project.id, outsider, input), { statusCode: 409 });
  await assert.rejects(services.updateIssue(project.id, original.id, outsider, { revision: 2, attachments: [file] }), { statusCode: 409 });
  for (const patch of [{ name: 'renamed.txt' }, { mimeType: 'application/octet-stream' }, { data: Buffer.from('changed!').toString('base64') }])
    await assert.rejects(services.updateIssue(project.id, original.id, actor, { revision: 2, attachments: [{ ...file, ...patch }] }), { statusCode: 409 });
  const next = await services.updateIssue(project.id, original.id, actor, { revision: 2, actualResult: 'merged retry', attachments: [file] });
  assert.equal(next.revision, 3);
  assert.equal(next.actualResult, 'merged retry');
  assert.equal(await database.client.projectFile.count(), 1);
  assert.equal((await services.downloadFile(project.id, file.id, actor)).data.toString(), 'original');
  assert.equal(await database.client.issueHistory.count({ where: { issueId: original.id } }), 3);
});
