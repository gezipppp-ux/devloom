const test = require("node:test");
const assert = require("node:assert/strict");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");

async function fixture(t) {
  const database = await initializeTestDatabase(t, temporary(t));
  const permissions = projectPermissionCatalog.filter(entry => entry.scope === "project").map(entry => entry.id);
  const department = await database.client.department.create({ data: { name: "协作测试", permissions } });
  const actor = await database.client.user.create({ data: { username: "content-owner", displayName: "content-owner", passwordHash: "not-used", role: "member", departmentId: department.id } });
  const outsider = await database.client.user.create({ data: { username: "content-outsider", displayName: "content-outsider", passwordHash: "not-used", role: "member", departmentId: department.id } });
  const project = await database.client.project.create({ data: { name: "项目甲", ownerUserId: actor.id, remoteUrl: "https://example.test/team/repo.git" } });
  const other = await database.client.project.create({ data: { name: "项目乙", ownerUserId: actor.id, remoteUrl: "https://example.test/team/repo.git" } });
  for (const selected of [project, other]) await database.client.projectMember.create({ data: { projectId: selected.id, userId: actor.id, permissions } });
  const projects = new ProjectServices(database);
  const services = new ProjectContentServices(database, projects);
  const setPermissions = value => database.client.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: actor.id } }, data: { permissions: value } });
  return { database, permissions, actor, outsider, project, other, projects, services, setPermissions };
}

test("project issues enforce membership, assignment, versioned acceptance and revision history without starting execution", async t => {
  const { database, permissions, actor, outsider, project, services, setPermissions } = await fixture(t);
  const issue = await services.createIssue(project.id, actor, { type: "requirement", title: "可验收需求", participantIds: [actor.id], acceptanceCriteria: "可验证" });
  assert.equal(issue.number, 1);
  assert.equal(issue.status, "planned");
  assert.equal(await database.client.developmentTask.count(), 0);
  await assert.rejects(services.readIssue(project.id, issue.id, outsider), { statusCode: 404 });
  await assert.rejects(services.createIssue(project.id, actor, { type: "bug", title: "缺陷", participantIds: [outsider.id] }), /有效项目成员/);
  const outcomes = await Promise.allSettled(["甲", "乙"].map(title => services.updateIssue(project.id, issue.id, actor, { title, revision: 1 })));
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(result => result.status === "rejected").reason.statusCode, 409);
  let current = await services.readIssue(project.id, issue.id, actor);
  for (const status of ["developing", "pending_verification", "verifying"]) current = await services.transitionIssue(project.id, issue.id, actor, { status, revision: current.revision });
  await setPermissions(permissions.filter(permission => permission !== "issue.accept"));
  await assert.rejects(services.transitionIssue(project.id, issue.id, actor, { status: "implemented", revision: current.revision }), { statusCode: 403 });
  await setPermissions(permissions);
  current = await services.transitionIssue(project.id, issue.id, actor, { status: "implemented", revision: current.revision });
  await assert.rejects(services.transitionIssue(project.id, issue.id, actor, { status: "planned", revision: current.revision }), /原因/);
  current = await services.transitionIssue(project.id, issue.id, actor, { status: "planned", revision: current.revision, reason: "再次打开" });
  await services.addComment(project.id, issue.id, actor, { body: "评审说明" });
  await services.addDeliverable(project.id, issue.id, actor, { body: "完成交付", commit: "abc123" });
  await assert.rejects(services.addDeliverable(project.id, issue.id, actor, { body: "非法任务", taskId: "foreign-task" }), /不属于/);
  assert.equal((await services.children(project.id, issue.id, actor, "comments", {})).items[0].body, "评审说明");
  const history = await services.children(project.id, issue.id, actor, "history", { limit: 2 });
  assert.equal(history.items.length, 2);
  assert.equal(history.nextOffset, 2);
  assert.equal(history.items[0].data.reason, "再次打开");
  assert.equal((await services.listIssues(project.id, actor, { status: "planned", query: current.title })).items.length, 1);
  assert.equal(await database.client.developmentTask.count(), 0);
});

test("project assets encrypt sensitive history, audit reads, enforce independent secret permissions and scope attachments", async t => {
  const { database, permissions, actor, outsider, project, other, services, setPermissions } = await fixture(t);
  const issue = await services.createIssue(project.id, actor, { type: "bug", title: "登录缺陷" });
  const foreign = await services.createIssue(other.id, actor, { type: "bug", title: "另一项目" });
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

test("TAPD import is project-local and idempotent, preserves local edits and rechecks revocation after fetch", async t => {
  const { database, actor, project, other, projects } = await fixture(t);
  const material = { type: "requirement", title: "来源标题", description: "捕获内容", source: { channel: "tapd", scope: "1", type: "story", externalId: "22", url: "https://www.tapd.cn/1/story/view/22", snapshot: { id: "22", title: "来源标题" } } };
  let calls = 0;
  const services = new ProjectContentServices(database, projects, { fetchTapd: async () => { calls++; return [material]; } });
  const imported = (await services.importTapd(project.id, actor, { items: [{ id: "22", type: "story" }] })).items[0];
  await services.updateIssue(project.id, imported.id, actor, { revision: 1, title: "本地维护标题" });
  const again = (await services.importTapd(project.id, actor, { items: [{ id: "22", type: "story" }] })).items[0];
  assert.equal(again.id, imported.id);
  assert.equal(again.title, "本地维护标题");
  assert.equal(again.reused, true);
  assert.notEqual((await services.importTapd(other.id, actor, {})).items[0].id, imported.id);
  const delayed = new ProjectContentServices(database, projects, { fetchTapd: async () => {
    await database.client.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: actor.id } }, data: { status: "inactive" } });
    return [{ ...material, source: { ...material.source, externalId: "23" } }];
  } });
  await assert.rejects(delayed.importTapd(project.id, actor, {}), { statusCode: 404 });
  assert.equal(await database.client.issueSource.count({ where: { externalId: "23" } }), 0);
  assert.equal(calls, 3);
});

test("issue attachments commit with full bug fields, enforce permissions and roll back conflicts", async t => {
  const { randomUUID } = require('node:crypto');
  const { png } = require('../support/helpers.cjs');
  const { database, permissions, actor, outsider, project, other, services, setPermissions } = await fixture(t);
  const attachment = (data = png) => ({ id: randomUUID(), name: '截图.png', mimeType: 'image/png', data: data.toString('base64') });
  const first = attachment();
  await setPermissions(['project.view', 'issue.view', 'issue.create']);
  const input = { type: 'bug', title: '完整缺陷', description: `![截图](/api/projects/${project.id}/files/${first.id})`, priority: 'urgent', severity: 'critical', reproductionSteps: '复现步骤', expectedResult: '预期', actualResult: '实际', acceptanceCriteria: '验收', attachments: [first] };
  const issue = await services.createIssue(project.id, actor, input);
  for (const key of ['description', 'priority', 'severity', 'reproductionSteps', 'expectedResult', 'actualResult', 'acceptanceCriteria']) assert.equal(issue[key], input[key]);
  await assert.rejects(services.createIssue(project.id, outsider, input), { statusCode: 404 });
  await setPermissions(['project.view', 'issue.view', 'issue.assign']);
  await assert.rejects(services.updateIssue(project.id, issue.id, actor, { revision: 1, attachments: [attachment()] }), { statusCode: 403 });
  await setPermissions(permissions);
  const view = await services.readIssue(project.id, issue.id, actor);
  assert.deepEqual(view.images, [{ source: `/api/projects/${project.id}/files/${first.id}`, url: `/api/projects/${project.id}/files/${first.id}?inline=1` }]);
  const foreign = await services.createIssue(other.id, actor, { type: 'bug', title: '另一项目', attachments: [attachment()] });
  const foreignFile = (await services.listFiles(other.id, 'issues', foreign.id, actor, {})).items[0];
  const fresh = attachment();
  await assert.rejects(services.updateIssue(project.id, issue.id, actor, { revision: 1, title: '不能保存', attachments: [fresh, { ...attachment(), id: foreignFile.id }] }), { statusCode: 409 });
  assert.equal((await services.readIssue(project.id, issue.id, actor)).title, issue.title);
  assert.equal(await database.client.projectFile.count({ where: { id: fresh.id } }), 0);
  assert.equal((await services.downloadFile(other.id, foreignFile.id, actor)).data.equals(png), true);
  const count = await database.client.projectIssue.count();
  await assert.rejects(services.createIssue(project.id, actor, { ...input, attachments: [fresh, first] }), { statusCode: 409 });
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
  const input = { requestId: randomUUID(), type: 'bug', title: 'retry', actualResult: 'original result', attachments: [file] };
  for (const requestId of [null, '', 'not-a-uuid']) await assert.rejects(services.createIssue(project.id, actor, { ...input, requestId }), { statusCode: 400 });
  const original = await services.createIssue(project.id, actor, input);
  assert.equal(original.id, input.requestId);
  const retried = await services.createIssue(project.id, actor, { ...input });
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
    await assert.rejects(services.createIssue(project.id, actor, { ...input, ...patch }), { statusCode: 409 });
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

test('TAPD import saves authenticated images atomically and retains source mappings on reuse and edits', async t => {
  const { png, session, item, json } = require('../support/helpers.cjs');
  const { ProjectDevelopmentServices } = require('../../src/application/project-development-services.cjs');
  const { database, actor, project, projects, services } = await fixture(t);
  await database.client.project.update({ where: { id: project.id }, data: { settings: { tapd: { session, image_hosts: ['cdn.example.test'] } } } });
  const workitem = { ...item, description: '<img data-src="/diagram.png?a=1&amp;b=2">', markdown_description: '![图][ref]\n\n[ref]: https://www.tapd.cn/diagram.png?a=1&b=2' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(database.context.getStore(), undefined, 'network must run outside a database transaction');
    const address = String(url); calls.push(address);
    if (address.includes('/aggregation/')) return json({ get_workitem_basic_info_ret: { data: workitem } });
    if (address.startsWith('https://www.tapd.cn/diagram')) {
      assert.equal(options.headers.cookie, session.cookie_header);
      return new Response(null, { status: 302, headers: { location: 'https://cdn.example.test/screen.png' } });
    }
    assert.equal(address, 'https://cdn.example.test/screen.png');
    assert.equal(options.headers.cookie, undefined);
    return new Response(png);
  });
  const input = { items: [{ id: item.id, type: 'story' }] };
  const imported = (await services.importTapd(project.id, actor, input)).items[0];
  assert.equal(imported.description, workitem.markdown_description);
  assert.equal(imported.reused, false);
  assert.equal(await database.client.projectFile.count(), 1);
  const file = (await services.listFiles(project.id, 'issues', imported.id, actor, {})).items[0];
  const detail = await services.readIssue(project.id, imported.id, actor);
  for (const source of ['/diagram.png?a=1&b=2', 'https://www.tapd.cn/diagram.png?a=1&b=2'])
    assert.ok(detail.images.some(image => image.source === source && image.url === file.previewUrl));
  assert.deepEqual(imported.images, detail.images);
  const originalSource = await database.client.issueSource.findFirst({ where: { issueId: imported.id } });
  assert.equal(originalSource.snapshot.description, workitem.description);
  const changed = await services.updateIssue(project.id, imported.id, actor, { revision: 1, title: '保留本地修改' });
  assert.deepEqual(changed.images, detail.images);
  const again = (await services.importTapd(project.id, actor, input)).items[0];
  assert.equal(again.id, imported.id);
  assert.equal(again.title, '保留本地修改');
  assert.equal(again.reused, true);
  assert.equal(await database.client.projectFile.count(), 1);
  assert.equal((await database.client.issueSource.findFirst({ where: { issueId: imported.id } })).capturedAt.getTime(), originalSource.capturedAt.getTime());
  const development = new ProjectDevelopmentServices(database, projects, {});
  const snapshot = await development.store.issues(project.id, [imported.id]);
  assert.deepEqual(await development.images(project.id, snapshot), [png]);
  assert.equal(calls.length, 6, 'each import deduplicates equivalent image sources');
});

test('failed TAPD image download or attachment persistence leaves no imported issue, source or file', async t => {
  const { png, session, item, json } = require('../support/helpers.cjs');
  const { database, actor, project, services } = await fixture(t);
  await database.client.project.update({ where: { id: project.id }, data: { settings: { tapd: { session } } } });
  let mode = 'bad-image';
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('/aggregation/')) return json({ get_workitem_basic_info_ret: { data: { ...item, description: '<img src="https://file.tapd.cn/diagram.png">' } } });
    return new Response(mode === 'bad-image' ? '<html>login</html>' : png);
  });
  const input = { items: [{ id: item.id, type: 'story' }] };
  await assert.rejects(services.importTapd(project.id, actor, input), /not PNG/);
  assert.equal(await database.client.projectIssue.count(), 0);
  mode = 'valid';
  const addFile = services.store.addFile.bind(services.store);
  t.mock.method(services.store, 'addFile', async (...args) => { await addFile(...args); throw new Error('simulated attachment failure'); });
  await assert.rejects(services.importTapd(project.id, actor, input), /simulated attachment failure/);
  for (const model of ['projectIssue', 'issueSource', 'projectFile', 'issueHistory']) assert.equal(await database.client[model].count(), 0, model);
  assert.equal((await database.client.project.findUnique({ where: { id: project.id } })).issueSequence, 0);
});
