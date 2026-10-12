const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
const { ProjectLifecycleServices } = require("../../src/application/project-lifecycle-services.cjs");
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");

async function fixture(t) {
  const database = await initializeTestDatabase(t, temporary(t));
  const permissions = projectPermissionCatalog.filter(entry => entry.scope === "project").map(entry => entry.id);
  const department = await database.client.department.create({ data: { name: "版本测试", permissions } });
  const actor = await database.client.user.create({ data: { username: "lifecycle", displayName: "版本测试", passwordHash: "unused", departmentId: department.id } });
  const project = await database.client.project.create({ data: { name: "版本项目", ownerUserId: actor.id, remoteUrl: "https://example.test/repo.git" } });
  await database.client.projectMember.create({ data: { projectId: project.id, userId: actor.id, permissions } });
  const projects = new ProjectServices(database);
  return { database, actor, projectId: project.id, lifecycle: new ProjectLifecycleServices(database, projects), content: new ProjectContentServices(database, projects) };
}

test("release creation and editing reject invalid names without changing persisted data", async t => {
  const { database, actor, projectId, lifecycle } = await fixture(t);
  for (const [index, name] of ["v0.5.9", "v0.1", "v1.0"].entries()) {
    let release = await lifecycle.saveRelease(projectId, null, actor, { name });
    assert.equal(release.name, name);
    for (const invalid of [undefined, null, 1, "", "随意命名", "1.0", "V1.0", "v1", "v1.0.0.0", "v01.0", "v1.0-beta", "v1.0\n"]) {
      await assert.rejects(lifecycle.saveRelease(projectId, null, actor, { name: invalid }), { statusCode: 400 });
      await assert.rejects(lifecycle.saveRelease(projectId, release.id, actor, { name: invalid, description: "不能覆盖", revision: release.revision }), { statusCode: 400 });
    }
    const unchanged = await database.client.projectRelease.findUnique({ where: { id: release.id } });
    assert.equal(unchanged.name, name);
    assert.equal(unchanged.description, "");
    assert.equal(unchanged.revision, release.revision);
    const updatedName = `v2.${index}`;
    release = await lifecycle.saveRelease(projectId, release.id, actor, { name: updatedName, revision: release.revision });
    assert.equal(release.name, updatedName);
    assert.equal(release.revision, unchanged.revision + 1);
  }
  assert.equal(await database.client.projectRelease.count({ where: { projectId } }), 3);
});

test("release archive gates unfinished work and protects all issue write paths until restore", async t => {
  const { actor, projectId, lifecycle, content } = await fixture(t);
  let release = await lifecycle.saveRelease(projectId, null, actor, { name: "v0.2" });
  const request = { requestId: randomUUID(), type: "bug", title: "版本缺陷", releaseId: release.id };
  let issue = await content.createIssue(projectId, actor, request);
  const asset = await content.saveAsset(projectId, null, actor, { type: "document", title: "版本文档", issueIds: [issue.id] });
  await assert.rejects(lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, true), /未完成/);
  issue = await content.transitionIssue(projectId, issue.id, actor, { revision: issue.revision, status: "cancelled", reason: "无需修复" });
  release = await lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, true);
  assert.equal((await content.listIssues(projectId, actor, {})).items.length, 0);
  assert.equal((await content.listIssues(projectId, actor, { includeArchived: "true", releaseId: release.id })).items.length, 1);
  assert.equal((await content.readIssue(projectId, issue.id, actor)).availableTransitions.length, 0);
  const replay = await content.createIssue(projectId, actor, request);
  assert.equal(replay.id, issue.id);
  assert.equal(replay.revision, issue.revision);
  for (const action of [
    () => content.updateIssue(projectId, issue.id, actor, { revision: issue.revision, title: "修改" }),
    () => content.updateIssue(projectId, issue.id, actor, { revision: issue.revision, releaseId: null }),
    () => content.transitionIssue(projectId, issue.id, actor, { revision: issue.revision, status: "pending", reason: "重开" }),
    () => content.addComment(projectId, issue.id, actor, { body: "评论" }),
    () => content.addDeliverable(projectId, issue.id, actor, { body: "交付" }),
    () => content.uploadFile(projectId, "issues", issue.id, actor, { name: "readme.txt", mimeType: "text/plain", data: Buffer.from("data") }),
    () => content.createIssue(projectId, actor, { type: "bug", title: "新事项", releaseId: release.id }),
    () => content.saveAsset(projectId, asset.id, actor, { revision: asset.revision, issueIds: [] }),
    () => content.saveAsset(projectId, null, actor, { type: "document", title: "新关联", issueIds: [issue.id] }),
  ]) await assert.rejects(action(), /归档/);
  release = await lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, false);
  assert.equal(release.status, "active");
  await content.addComment(projectId, issue.id, actor, { body: "恢复后可评论" });
});

test("archived imported issues are reused without modifying snapshots or attachments", async t => {
  const { database, actor, projectId, lifecycle, content } = await fixture(t);
  const material = { type: "requirement", title: "来源事项", source: { channel: "tapd", scope: "1", type: "story", externalId: "22", url: "https://www.tapd.cn/1/story/view/22", snapshot: { title: "原始快照" } } };
  content.fetchTapd = async () => [material];
  let issue = (await content.importTapd(projectId, actor, {})).items[0];
  const release = await lifecycle.saveRelease(projectId, null, actor, { name: "v0.3" });
  issue = await content.updateIssue(projectId, issue.id, actor, { revision: issue.revision, releaseId: release.id });
  issue = await content.transitionIssue(projectId, issue.id, actor, { revision: issue.revision, status: "rejected", reason: "关闭历史需求" });
  await lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, true);
  material.title = "不应覆盖的远端标题";
  material.attachments = [{ name: "unexpected.txt", mimeType: "text/plain", data: Buffer.from("unexpected") }];
  const reused = (await content.importTapd(projectId, actor, {})).items[0];
  assert.equal(reused.title, "来源事项");
  assert.equal(reused.revision, issue.revision);
  assert.equal(reused.reused, true);
  assert.equal(await database.client.projectFile.count({ where: { issueId: issue.id } }), 0);
});

test("release archive racing an issue reopen cannot leave an archived unfinished issue", async t => {
  const { actor, projectId, lifecycle, content } = await fixture(t);
  for (let attempt = 0; attempt < 3; attempt++) {
    const release = await lifecycle.saveRelease(projectId, null, actor, { name: `v0.4.${attempt}` });
    let issue = await content.createIssue(projectId, actor, { type: "bug", title: "并发重开", releaseId: release.id });
    issue = await content.transitionIssue(projectId, issue.id, actor, { revision: issue.revision, transitionId: "pending_cancelled", reason: "暂不处理" });
    const results = await Promise.allSettled([
      lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, true),
      content.transitionIssue(projectId, issue.id, actor, { revision: issue.revision, transitionId: "cancelled_pending", reason: "重新处理" }),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected");
    assert.equal(rejected.reason.statusCode, 409);
    const current = await content.readIssue(projectId, issue.id, actor);
    assert.ok(current.release.status !== "archived" || current.status === "cancelled");
  }
});
