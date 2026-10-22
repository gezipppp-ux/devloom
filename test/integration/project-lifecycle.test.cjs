const { installReviewWorkflow } = require("../support/workflow-fixture.cjs");
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
  const project = await database.client.project.create({ data: { name: "版本项目", directoryName: "repo", directoryKey: "repo", ownerUserId: actor.id, remoteUrl: "https://example.test/repo.git" } });
  await database.client.projectMember.create({ data: { projectId: project.id, userId: actor.id, permissions } });
  const projects = new ProjectServices(database);
  return { database, actor, projectId: project.id, lifecycle: new ProjectLifecycleServices(database, projects), content: new ProjectContentServices(database, projects) };
}

test("release archive refuses unresolved delivery reviews even when its issues are terminal", async t => {
  const { database, actor, projectId, lifecycle, content } = await fixture(t);
  await installReviewWorkflow(database);
  const release = await lifecycle.saveRelease(projectId, null, actor, { name: "v3.1" });
  const issue = await content.createIssue(projectId, actor, { type: "requirement", title: "Completed scope", releaseId: release.id });
  const delivery = await content.addDeliverable(projectId, actor, { issueId: issue.id, body: "Handover evidence", reviewerId: actor.id });
  // Seed an inconsistent terminal issue to exercise archive defense independently of workflow gates.
  await database.client.projectIssue.update({ where: { id: issue.id }, data: { status: "done" } });
  await assert.rejects(lifecycle.archiveRelease(projectId, release.id, actor, { revision: 1 }, true), /交付/);
  await database.client.projectDeliverable.update({ where: { id: delivery.id }, data: { status: "returned" } });
  await assert.rejects(lifecycle.archiveRelease(projectId, release.id, actor, { revision: 1 }, true), /交付/);
  await database.client.projectDeliverable.update({ where: { id: delivery.id }, data: { status: "accepted" } });
  assert.equal((await lifecycle.archiveRelease(projectId, release.id, actor, { revision: 1 }, true)).status, "archived");
});

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

test("release archive checks continued execution after task completion and retained deletion summaries", async t => {
  const { database, actor, projectId, lifecycle, content } = await fixture(t);
  let release = await lifecycle.saveRelease(projectId, null, actor, { name: "v3.2" });
  let issue = await content.createIssue(projectId, actor, { type: "requirement", title: "Finished scope", releaseId: release.id });
  issue = await content.transitionIssue(projectId, issue.id, actor, { revision: issue.revision, transitionId: "pending_cancelled", reason: "Finished" });
  const workspace = await database.client.workspace.create({ data: { name: "Continued session", ownerUserId: actor.id } });
  const snapshot = { kind: "issues", issues: [issue], additions: [] };
  const task = await database.client.developmentTask.create({ data: { projectId, releaseId: release.id, creatorId: actor.id, executorId: actor.id, requestId: randomUUID(), status: "completed", snapshot, workspaceId: workspace.id, runKey: "continued" } });
  const run = await database.client.run.create({ data: { path: `workspaces/${workspace.id}/runs/continued`, workspaceId: workspace.id, ownerUserId: actor.id, runKey: "continued", executionState: "running", data: { execution: { status: "running" } } } });
  await assert.rejects(lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, true), /执行/);
  await database.client.run.update({ where: { path: run.path }, data: { executionState: "completed", data: { execution: { status: "completed" } } } });
  release = await lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, true);
  release = await lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, false);
  await database.client.run.delete({ where: { path: run.path } });
  await assert.rejects(lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, true), /状态不明/);
  await database.client.developmentTask.update({ where: { id: task.id }, data: { snapshot: { ...snapshot, sessionDeletion: { execution: { status: "completed" } } } } });
  assert.equal((await lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, true)).status, "archived");
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
    () => content.addDeliverable(projectId, actor, { reviewerId: actor.id, issueId: issue.id, body: "交付" }),
    () => content.uploadFile(projectId, "issues", issue.id, actor, { name: "readme.txt", mimeType: "text/plain", data: Buffer.from("data") }),
    () => content.createIssue(projectId, actor, { type: "bug", title: "新事项", releaseId: release.id }),
    () => content.saveAsset(projectId, asset.id, actor, { revision: asset.revision, issueIds: [] }),
    () => content.saveAsset(projectId, null, actor, { type: "document", title: "新关联", issueIds: [issue.id] }),
  ]) await assert.rejects(action(), /归档/);
  release = await lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, false);
  assert.equal(release.status, "active");
  await content.addComment(projectId, issue.id, actor, { body: "恢复后可评论" });
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

test("release dates preserve omitted values, clear explicitly, and retain revision and archive protections", async t => {
  const { database, actor, projectId, lifecycle } = await fixture(t);
  let release = await lifecycle.saveRelease(projectId, null, actor, { name: "v5.0", targetDate: "2024-02-29" });
  assert.equal(release.targetDate, "2024-02-29");
  assert.deepEqual(release.progress, { total: 0, completed: 0, cancelled: 0 });
  assert.equal((await database.client.projectRelease.findUnique({ where: { id: release.id } })).targetDate.toISOString(), "2024-02-29T00:00:00.000Z");
  await assert.rejects(lifecycle.saveRelease(projectId, release.id, actor, { name: release.name, targetDate: "2026-02-29", revision: release.revision }), { statusCode: 400 });
  release = await lifecycle.saveRelease(projectId, release.id, actor, { name: release.name, description: "仅修改说明", revision: release.revision });
  assert.equal(release.targetDate, "2024-02-29");
  await assert.rejects(lifecycle.saveRelease(projectId, release.id, actor, { name: release.name, targetDate: null, revision: release.revision - 1 }), { statusCode: 409 });
  release = await lifecycle.saveRelease(projectId, release.id, actor, { name: release.name, targetDate: null, revision: release.revision });
  assert.equal(release.targetDate, null);
  release = await lifecycle.archiveRelease(projectId, release.id, actor, { revision: release.revision }, true);
  await assert.rejects(lifecycle.saveRelease(projectId, release.id, actor, { name: release.name, targetDate: "2026-10-23", revision: release.revision }), { statusCode: 409 });
});

test("release progress uses each issue's recorded workflow and excludes other projects and versions", async t => {
  const { database, actor, projectId, lifecycle, content } = await fixture(t);
  const release = await lifecycle.saveRelease(projectId, null, actor, { name: "v6.0" });
  const otherRelease = await lifecycle.saveRelease(projectId, null, actor, { name: "v6.1" });
  const requirement = await content.createIssue(projectId, actor, { type: "requirement", title: "已完成需求", releaseId: release.id });
  const bug = await content.createIssue(projectId, actor, { type: "bug", title: "已完成缺陷", releaseId: release.id });
  const cancelled = await content.createIssue(projectId, actor, { type: "bug", title: "取消缺陷", releaseId: release.id });
  await content.createIssue(projectId, actor, { type: "requirement", title: "未完成需求", releaseId: release.id });
  await content.createIssue(projectId, actor, { type: "requirement", title: "其他版本", releaseId: otherRelease.id });
  await content.createIssue(projectId, actor, { type: "requirement", title: "未排期" });
  await database.client.projectIssue.update({ where: { id: requirement.id }, data: { status: "implemented" } });
  await database.client.projectIssue.update({ where: { id: bug.id }, data: { status: "closed" } });
  await database.client.projectIssue.update({ where: { id: cancelled.id }, data: { status: "cancelled" } });
  const { workflowVersion: version } = await database.client.projectIssue.findUnique({ where: { id: requirement.id }, include: { workflowVersion: true } });
  await database.client.systemWorkflowVersion.create({ data: { workflowId: version.workflowId, version: version.version + 1, definition: { ...version.definition, nodes: version.definition.nodes.map(node => ({ ...node, kind: node.id === "implemented" ? "normal" : node.kind })) } } });
  const items = (await lifecycle.listReleases(projectId, actor)).items;
  assert.deepEqual(items.find(item => item.id === release.id).progress, { total: 4, completed: 2, cancelled: 1 });
  assert.deepEqual(items.find(item => item.id === otherRelease.id).progress, { total: 1, completed: 0, cancelled: 0 });
  await database.client.projectMember.updateMany({ where: { projectId, userId: actor.id }, data: { permissions: ["project.view"] } });
  await assert.rejects(lifecycle.listReleases(projectId, actor), { statusCode: 403 });
});
