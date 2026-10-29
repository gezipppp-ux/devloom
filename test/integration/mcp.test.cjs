const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const http = require("node:http");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { initializeTestDatabase } = require("../support/database.cjs");
const { temporary, png } = require("../support/helpers.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { McpTokenServices } = require("../../src/application/mcp-token-services.cjs");
const { SystemWorkflowServices } = require("../../src/application/system-workflow-services.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { contentFields, assignmentFields } = require("../../src/domain/project-issues.cjs");
const permissions = require("../../shared/project-permissions.json");
const scopes = require("../../shared/mcp-scopes.json").map(row => row.id);
const owners = id => ({ businessOwnerId: id, qaOwnerId: id, acceptanceOwnerId: id });

async function fixture(t) {
  const database = await initializeTestDatabase(t, temporary(t));
  const accounts = new AccountServices(database);
  const admin = await accounts.create({ username: "admin", password: "fixture-password-123" }, null, true);
  const department = await database.client.department.create({ data: { name: "MCP 测试", permissions: permissions.map(row => row.id) } });
  const members = [];
  for (const username of ["developer", "participant"]) {
    members.push(await database.client.user.create({ data: { username, displayName: username, passwordHash: "unused", departmentId: department.id } }));
  }
  const projects = new ProjectServices(database);
  const project = (await projects.create(admin, { name: "MCP 项目", remoteUrl: "https://example.invalid/repo.git" })).project;
  for (const member of members) await database.client.projectMember.create({ data: {
    projectId: project.id, userId: member.id, permissions: permissions.filter(row => row.scope !== "department").map(row => row.id),
  } });
  const tokens = new McpTokenServices(database, projects);
  const credential = await tokens.create(admin, { name: "测试 CLI", scopes, allProjects: false, projectIds: [project.id], expiresInDays: 30 });
  let maintenance = false;
  const server = createWebServer({ database, environment: { status: () => ({ busy: maintenance }), close: async () => {} } });
  const origin = await server.listen(0);
  t.after(() => server.close());
  async function request(path, { method = "GET", secret = credential.secret, body, headers = {} } = {}) {
    const response = await fetch(origin + path, { method, headers: { ...(secret ? { authorization: "Bearer " + secret } : {}), ...headers }, body });
    const data = await response.json();
    return { status: response.status, data, headers: response.headers };
  }
  const upload = (id = randomUUID(), bytes = png, options = {}) => request("/api/mcp/projects/" + project.id + "/uploads?name=shot.png", {
    method: "POST", secret: uploadCredential.uploadToken, body: bytes, headers: { "content-type": "image/png", "idempotency-key": id }, ...options,
  });
  async function connect(secret = credential.secret) {
    const client = new Client({ name: "fixture-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + "/mcp"), { requestInit: { headers: { authorization: "Bearer " + secret } } }));
    t.after(() => client.close());
    return client;
  }
  const uploadCredential = await call(await connect(), "create_upload_token", { projectId: project.id });
  return { database, admin, members, projects, project, tokens, credential, uploadCredential, origin, request, upload, connect, setMaintenance: value => { maintenance = value; } };
}
async function call(client, name, input = {}) {
  const result = await client.callTool({ name, arguments: input });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent;
}
async function error(client, name, input, status) {
  const result = await client.callTool({ name, arguments: input });
  assert.equal(result.isError, true, JSON.stringify(result));
  if (status) assert.equal(result.structuredContent.error.status, status, JSON.stringify(result));
  return result;
}

test("MCP validates workflow responsibility permissions on create and reassignment", async t => {
  const f = await fixture(t), client = await f.connect(), projectId = f.project.id;
  const member = f.members[0];
  const key = { projectId_userId: { projectId, userId: member.id } };
  const membership = await f.database.client.projectMember.findUnique({ where: key });
  await f.database.client.projectMember.update({ where: key, data: { permissions: membership.permissions.filter(p => p !== "deliverable.review" && p !== "issue.accept") } });
  const listed = (await call(client, "list_project_members", { projectId })).items.find(row => row.id === member.id);
  assert.ok(!listed.effectivePermissions.includes("deliverable.review"));
  const workflow = (await call(client, "get_issue_workflow", { projectId, type: "bug" })).workflow;
  const requirements = workflow.versions.find(version => version.version === workflow.publishedVersion).responsibilityPermissions;
  assert.ok(requirements.qaOwnerId.includes("deliverable.review"));
  assert.ok(requirements.acceptanceOwnerId.includes("issue.accept"));
  const input = { ...owners(f.admin.id), projectId, requestId: randomUUID(), type: "bug", title: "职责权限" };
  await error(client, "create_issue", { ...input, qaOwnerId: member.id }, 400);
  assert.equal(await f.database.client.projectIssue.count(), 0);
  const { issue } = await call(client, "create_issue", { ...input, requestId: randomUUID() });
  assert.deepEqual(issue.responsibilityPermissions, requirements);
  await error(client, "update_issue", { projectId, issueId: issue.id, requestId: randomUUID(), revision: issue.revision, acceptanceOwnerId: member.id }, 400);
  assert.equal((await call(client, "get_issue", { projectId, issueId: issue.id })).issue.acceptanceOwnerId, f.admin.id);
  await f.database.client.projectMember.update({ where: key, data: { permissions: membership.permissions } });
  const updated = await call(client, "update_issue", { projectId, issueId: issue.id, requestId: randomUUID(), revision: issue.revision, qaOwnerId: member.id, acceptanceOwnerId: member.id });
  assert.equal(updated.issue.qaOwnerId, member.id);
  assert.equal(updated.issue.acceptanceOwnerId, member.id);
  await f.database.client.projectMember.update({ where: key, data: { permissions: membership.permissions.filter(p => p !== "deliverable.review" && p !== "issue.accept") } });
  const edit = await call(client, "update_issue", { projectId, issueId: issue.id, requestId: randomUUID(), revision: updated.issue.revision, title: "保留既有职责" });
  assert.equal(edit.issue.qaOwnerId, member.id);
});

test("MCP cannot read, edit, assign or replay publication of a deleted issue", async t => {
  const f = await fixture(t), client = await f.connect();
  const input = { ...owners(f.admin.id), projectId: f.project.id, requestId: randomUUID(), type: "requirement", title: "不明确的 MCP 需求", description: "待重新整理", acceptanceCriteria: ["补充后重新提报"] };
  const created = await call(client, "create_issue", input);
  const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
  await new ProjectContentServices(f.database, f.projects).deleteIssue(f.project.id, created.issue.id, f.admin, { revision: created.issue.revision });
  await error(client, "get_issue", { projectId: f.project.id, issueId: created.issue.id }, 404);
  await error(client, "create_issue", input, 404);
  await error(client, "get_request_result", { projectId: f.project.id, requestId: input.requestId }, 404);
  await error(client, "update_issue", { projectId: f.project.id, issueId: created.issue.id, requestId: randomUUID(), revision: created.issue.revision, title: "不得复活" }, 404);
  await error(client, "assign_issue", { projectId: f.project.id, issueId: created.issue.id, requestId: randomUUID(), revision: created.issue.revision, developerId: f.members[0].id }, 404);
  assert.equal((await call(client, "search_issues", { projectId: f.project.id })).items.length, 0);
  assert.equal(await f.database.client.developmentTask.count(), 0);
});

test("MCP deletion returns only an idempotent receipt and preserves deleted content privately", async t => {
  const f = await fixture(t), client = await f.connect(), projectId = f.project.id;
  const tool = (await client.listTools()).tools.find(tool => tool.name === "delete_issue");
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["issueId", "projectId", "requestId", "revision"]);
  assert.deepEqual(tool.inputSchema.required.slice().sort(), ["issueId", "projectId", "requestId", "revision"]);
  assert.equal(tool.annotations.destructiveHint, true);
  assert.equal(tool.annotations.idempotentHint, true);
  assert.equal(tool.annotations.readOnlyHint, false);
  for (const type of ["requirement", "bug"]) {
    const creation = { ...owners(f.admin.id), projectId, requestId: randomUUID(), type, title: "待清理的 " + type, description: "保留但不再公开的正文" };
    const { issue } = await call(client, "create_issue", creation);
    const input = { projectId, issueId: issue.id, revision: issue.revision, requestId: randomUUID() };
    for (const invalid of [{ revision: 0 }, { revision: undefined }, { force: true }, { issueIds: [issue.id] }])
      await error(client, "delete_issue", { ...input, ...invalid });
    const deleted = { id: issue.id, deleted: true };
    assert.deepEqual(await call(client, "delete_issue", input), { ...deleted, reused: false });
    assert.deepEqual(await call(client, "delete_issue", input), { ...deleted, reused: true });
    assert.deepEqual(await call(client, "get_request_result", { projectId, requestId: input.requestId }), { operation: "delete_issue", ...deleted, reused: true });
    await error(client, "delete_issue", { ...input, revision: input.revision + 1 }, 409);
    await error(client, "delete_issue", { ...input, requestId: randomUUID() }, 404);
    await error(client, "get_issue", { projectId, issueId: issue.id }, 404);
    await error(client, "create_issue", creation, 404);
    await error(client, "get_request_result", { projectId, requestId: creation.requestId }, 404);
    const stored = await f.database.client.projectIssue.findUnique({ where: { id: issue.id } });
    assert.ok(stored.deletedAt);
    assert.equal(stored.description, creation.description);
    assert.equal(stored.revision, issue.revision + 1);
    assert.equal(await f.database.client.issueHistory.count({ where: { issueId: issue.id, action: "deleted" } }), 1);
    assert.equal(await f.database.client.auditEvent.count({ where: { event: "mcp.delete_issue", details: { path: ["requestId"], equals: input.requestId } } }), 1);
    assert.deepEqual((await f.database.client.mcpOperation.findUnique({ where: { userId_requestId: { userId: f.admin.id, requestId: input.requestId } } })).result, deleted);
  }
  assert.deepEqual((await call(client, "search_issues", { projectId })).items, []);
});

test("MCP deletion requires an explicit token scope and current project permission, including receipts", async t => {
  const f = await fixture(t), client = await f.connect(), projectId = f.project.id;
  const legacy = await f.tokens.create(f.admin, { name: "既有编辑授权", scopes: scopes.filter(scope => scope !== "issues.delete"), allProjects: true, projectIds: [], expiresInDays: 7 });
  const legacyClient = await f.connect(legacy.secret);
  assert.equal((await legacyClient.listTools()).tools.some(tool => tool.name === "delete_issue"), false);
  const { issue } = await call(client, "create_issue", { ...owners(f.admin.id), projectId, requestId: randomUUID(), type: "bug", title: "独立删除授权" });
  const input = { projectId, issueId: issue.id, requestId: randomUUID(), revision: issue.revision };
  await error(legacyClient, "delete_issue", input);
  const other = (await f.projects.create(f.admin, { name: "删除范围之外", remoteUrl: "https://example.invalid/other.git" })).project;
  await error(client, "delete_issue", { ...input, projectId: other.id }, 403);
  const credential = await f.tokens.create(f.members[0], { name: "仅删除", scopes: ["read", "issues.delete"], allProjects: false, projectIds: [projectId], expiresInDays: 7 });
  const deleter = await f.connect(credential.secret);
  const membership = { projectId_userId: { projectId, userId: f.members[0].id } };
  const full = (await f.database.client.projectMember.findUnique({ where: membership })).permissions;
  await f.database.client.projectMember.update({ where: membership, data: { permissions: full.filter(permission => permission !== "issue.delete") } });
  await error(deleter, "delete_issue", input, 403);
  await f.database.client.projectMember.update({ where: membership, data: { permissions: full } });
  assert.equal((await call(deleter, "delete_issue", input)).deleted, true, "deletion does not require editing scope");
  await error(client, "get_request_result", { projectId, requestId: input.requestId }, 404, "receipt belongs to its author");
  await f.database.client.projectMember.update({ where: membership, data: { permissions: full.filter(permission => permission !== "issue.delete") } });
  await error(deleter, "delete_issue", input, 403);
  await error(deleter, "get_request_result", { projectId, requestId: input.requestId }, 403);
  await f.database.client.projectMember.update({ where: membership, data: { permissions: full } });
  const readerToken = await f.tokens.create(f.members[0], { name: "仅读取", scopes: ["read"], allProjects: true, projectIds: [], expiresInDays: 7 });
  await error(await f.connect(readerToken.secret), "get_request_result", { projectId, requestId: input.requestId }, 403);
});

test("MCP deletion rejects stale revisions, archives and every development or delivery association", async t => {
  const f = await fixture(t), client = await f.connect(), projectId = f.project.id;
  const create = async input => (await call(client, "create_issue", { ...owners(f.admin.id), projectId, requestId: randomUUID(), type: "requirement", title: "删除门禁", ...input })).issue;
  const inputFor = issue => ({ projectId, issueId: issue.id, revision: issue.revision, requestId: randomUUID() });
  const stale = await create();
  await call(client, "update_issue", { ...inputFor(stale), title: "已更新" });
  await error(client, "delete_issue", inputFor(stale), 409);
  const linked = await create({ developerId: f.members[0].id });
  const detail = await call(client, "get_issue", { projectId, issueId: linked.id });
  for (const status of ["planned", "cancelled", "completed", "merged"]) {
    await f.database.client.developmentTask.update({ where: { id: detail.developmentTask.id }, data: { status } });
    if (status !== "planned") await f.database.client.issueDevelopmentClaim.deleteMany({ where: { issueId: linked.id } });
    await error(client, "delete_issue", inputFor(linked), 409);
  }
  const delivered = await create();
  await f.database.client.projectDeliverable.create({ data: { projectId, issueId: delivered.id, authorId: f.admin.id, reviewerId: f.admin.id, body: "既有交付", status: "accepted" } });
  await error(client, "delete_issue", inputFor(delivered), 409);
  const release = (await call(client, "create_release", { projectId, requestId: randomUUID(), name: "v9.0" })).release;
  const archived = await create({ releaseId: release.id });
  await f.database.client.projectRelease.update({ where: { id: release.id }, data: { status: "archived" } });
  await error(client, "delete_issue", inputFor(archived), 409);
  const plain = await create();
  f.setMaintenance(true);
  await error(client, "delete_issue", inputFor(plain), 409);
  f.setMaintenance(false);
  await f.database.client.project.update({ where: { id: projectId }, data: { status: "archived" } });
  await error(client, "delete_issue", inputFor(plain), 409);
  assert.equal(await f.database.client.projectIssue.count({ where: { deletedAt: { not: null } } }), 0);
  assert.equal(await f.database.client.mcpOperation.count({ where: { kind: "delete_issue" } }), 0);
});

test("MCP deletion rolls back content and receipts if authorization is revoked before commit", async t => {
  const f = await fixture(t), client = await f.connect(), projectId = f.project.id;
  const { issue } = await call(client, "create_issue", { ...owners(f.admin.id), projectId, requestId: randomUUID(), type: "bug", title: "事务内撤销授权" });
  const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
  const { McpProjectServices } = require("../../src/application/mcp-project-services.cjs");
  const content = new ProjectContentServices(f.database, f.projects);
  const remove = content.deleteIssue.bind(content);
  t.mock.method(content, "deleteIssue", async (...args) => {
    const result = await remove(...args);
    await f.tokens.revoke(f.admin, f.credential.token.id);
    return result;
  });
  const services = new McpProjectServices(f.database, { tokens: f.tokens, projects: f.projects, content });
  const context = await f.tokens.authenticate("Bearer " + f.credential.secret);
  await assert.rejects(services.deleteIssue(context, { projectId, issueId: issue.id, requestId: randomUUID(), revision: issue.revision }), { statusCode: 401 });
  const stored = await f.database.client.projectIssue.findUnique({ where: { id: issue.id } });
  assert.equal(stored.deletedAt, null);
  assert.equal(stored.revision, issue.revision);
  assert.equal(await f.database.client.mcpOperation.count({ where: { kind: "delete_issue" } }), 0);
  assert.equal(await f.database.client.issueHistory.count({ where: { action: "deleted" } }), 0);
  assert.equal(await f.database.client.auditEvent.count({ where: { event: { in: ["issue.deleted", "mcp.delete_issue"] } } }), 0);
});

test("MCP client publishes images, release and assignment atomically with replay and conflict recovery", async t => {
  const f = await fixture(t), client = await f.connect();
  const projectId = f.project.id;
  const listed = await client.listTools();
  assert.ok(listed.tools.some(tool => tool.name === "create_issue"));
  assert.equal((await call(client, "whoami")).user.id, f.admin.id);
  assert.deepEqual((await call(client, "whoami")).upload.mimeTypes, ["*/*"]);
  assert.deepEqual((await call(client, "list_projects")).items.map(row => row.id), [projectId]);
  const members = (await call(client, "list_project_members", { projectId, assignableOnly: true })).items;
  assert.equal(members.length, 3);
  assert.ok(members.some(member => member.id === f.admin.id), "administrators are assignable without department grants");
  const releaseInput = { requestId: randomUUID(), projectId, name: "v1.2.3", targetDate: "2026-11-30" };
  const release = await call(client, "create_release", releaseInput);
  assert.equal(release.release.targetDate, releaseInput.targetDate);
  await error(client, "create_release", { ...releaseInput, requestId: randomUUID(), name: "v1.2.5", targetDate: "2026-02-30" }, 400);
  assert.equal((await call(client, "create_release", releaseInput)).reused, true);
  await error(client, "create_release", { ...releaseInput, name: "v1.2.4" }, 409);
  assert.equal((await call(client, "list_releases", { status: "all" })).items[0].id, release.release.id);
  const uploaded = await f.upload();
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded));
  const fileId = uploaded.data.attachmentId;
  assert.equal((await f.upload(fileId)).data.attachmentId, fileId);
  assert.equal((await f.upload(fileId, Buffer.concat([png, Buffer.from("changed")]))).status, 409);
  const textBytes = Buffer.from("# 附件需求\n\n保留原始 UTF-8 内容");
  const textUpload = await f.request("/api/mcp/projects/" + projectId + "/uploads?name=requirements.md", {
    method: "POST", secret: f.uploadCredential.uploadToken, body: textBytes,
    headers: { "content-type": "text/markdown", "idempotency-key": randomUUID() },
  });
  assert.equal(textUpload.status, 201);
  assert.ok(textUpload.data.markdown.startsWith("[附件]"));
  const input = { ...owners(f.admin.id), projectId, requestId: randomUUID(), type: "bug", title: "截图缺陷", description: "截图\n" + uploaded.data.markdown + "\n" + textUpload.data.markdown, acceptanceCriteria: ["结果符合预期\n包含详细说明", "核对截图 " + uploaded.data.markdown],
    releaseId: release.release.id, attachmentIds: [fileId, textUpload.data.attachmentId], developerId: f.members[0].id, watcherIds: [f.members[1].id] };
  const published = await call(client, "create_issue", input);
  assert.equal(published.issue.developerId, f.members[0].id);
  assert.equal(published.issue.acceptanceCriteria.length, 2);
  assert.equal(published.issue.acceptanceCriteria[0], "结果符合预期\n包含详细说明");
  assert.match(published.issue.acceptanceCriteria[1], /\/api\/projects\/.*\/files\//);
  assert.equal(published.developmentTask.status, "planned");
  assert.match(published.issue.description, /\/api\/projects\/.*\/files\//);
  assert.deepEqual(new Set(published.attachments.map(file => file.id)), new Set(input.attachmentIds));
  assert.deepEqual(Buffer.from((await f.database.client.projectFile.findUnique({ where: { id: textUpload.data.attachmentId } })).data), textBytes);
  assert.equal((await f.database.client.mcpUpload.findUnique({ where: { id: fileId } })).data, null);
  assert.equal(await f.database.client.run.count(), 0, "publishing never starts an agent");
  const replay = await call(client, "create_issue", input);
  assert.equal(replay.reused, true);
  assert.equal(replay.issue.id, published.issue.id);
  assert.equal(await f.database.client.projectIssue.count(), 1);
  assert.equal(await f.database.client.developmentTask.count(), 1);
  assert.equal((await call(client, "get_request_result", { projectId, requestId: input.requestId })).issue.id, published.issue.id);
  await error(client, "create_issue", { ...input, title: "changed" }, 409);
  const detail = await call(client, "get_issue", { projectId, issueId: published.issue.id });
  const reassigned = await call(client, "assign_issue", { projectId, issueId: detail.issue.id, revision: detail.issue.revision,
    taskRevision: detail.developmentTask.revision, requestId: randomUUID(), developerId: f.members[1].id });
  assert.equal(reassigned.issue.developerId, f.members[1].id);
  const update = { projectId, issueId: detail.issue.id, revision: reassigned.issue.revision, requestId: randomUUID(), title: "修正缺陷" };
  const updated = await call(client, "update_issue", update);
  assert.equal(updated.issue.title, update.title);
  assert.equal((await call(client, "update_issue", update)).reused, true);
  await error(client, "update_issue", { ...update, requestId: randomUUID() }, 409);
  assert.equal((await call(client, "search_issues", { projectId, query: "修正" })).items.length, 1);
  const anotherUpload = await f.upload();
  const bad = { ...input, requestId: randomUUID(), attachmentIds: [anotherUpload.data.attachmentId], description: anotherUpload.data.markdown, developerId: randomUUID() };
  await error(client, "create_issue", bad);
  assert.equal(await f.database.client.projectIssue.count(), 1);
  assert.equal((await f.database.client.mcpUpload.findUnique({ where: { id: anotherUpload.data.attachmentId } })).issueId, null);
  await error(client, "create_issue", { ...input, requestId: randomUUID() }, 409, "bound files cannot be attached to another issue");
  const concurrentInput = { ...owners(f.admin.id), projectId, requestId: randomUUID(), type: "requirement", title: "并发发布", description: "两个相同请求" };
  const concurrent = await Promise.all([client.callTool({ name: "create_issue", arguments: concurrentInput }), client.callTool({ name: "create_issue", arguments: concurrentInput })]);
  assert.ok(concurrent.some(result => !result.isError));
  assert.equal((await call(client, "create_issue", concurrentInput)).reused, true);
  assert.equal(await f.database.client.projectIssue.count(), 2);
  const archived = await call(client, "create_release", { projectId, requestId: randomUUID(), name: "v3.0" });
  await f.database.client.projectRelease.update({ where: { id: archived.release.id }, data: { status: "archived" } });
  assert.equal((await call(client, "list_releases", { projectIds: [projectId], status: "archived" })).items[0].id, archived.release.id);
  assert.equal((await call(client, "list_releases", { projectIds: [projectId] })).items.length, 1);
  await error(client, "create_issue", { ...concurrentInput, requestId: randomUUID(), releaseId: archived.release.id }, 409);
});

test("MCP tokens enforce current account, scopes, project and upload ownership across slow requests", async t => {
  const f = await fixture(t), client = await f.connect();
  assert.equal((await f.request("/api/mcp/whoami", { secret: "" })).status, 401);
  assert.equal((await f.request("/api/mcp/whoami?token=" + f.credential.secret)).status, 400);
  assert.equal((await f.upload(undefined, png, { headers: { origin: "https://foreign.invalid" } })).status, 403);
  const generic = await f.upload(randomUUID(), Buffer.from("<html>fake image</html>"));
  assert.equal(generic.status, 201);
  assert.ok(generic.data.markdown.startsWith("[附件]"), "declared image MIME cannot turn a non-image file into image Markdown");
  assert.equal((await f.upload(randomUUID(), Buffer.alloc(10 * 1024 * 1024 + 1))).status, 400);
  const otherProject = (await f.projects.create(f.admin, { name: "未授权项目", remoteUrl: "https://example.invalid/other.git" })).project;
  await error(client, "get_issue", { projectId: otherProject.id, issueId: randomUUID() }, 403);
  await error(client, "get_issue_workflow", { projectId: otherProject.id, type: "requirement" }, 403);
  const narrow = await f.tokens.create(f.admin, { name: "只读", scopes: ["read"], allProjects: true, projectIds: [], expiresInDays: 7 });
  const reader = await f.connect(narrow.secret);
  const workflow = (await call(reader, "get_issue_workflow", { projectId: f.project.id, type: "requirement" })).workflow;
  assert.ok(workflow.versions.some(version => version.version === workflow.publishedVersion));
  assert.equal(Object.hasOwn(workflow, "draft"), false);
  assert.equal(Object.hasOwn(workflow, "revision"), false);
  assert.equal((await reader.listTools()).tools.some(tool => tool.name === "create_issue"), false);
  assert.equal((await reader.listTools()).tools.some(tool => tool.name === "create_upload_token"), false);
  assert.equal((await f.upload(undefined, png, { secret: narrow.secret })).status, 401);
  await assert.rejects(f.tokens.createUploadToken(await f.tokens.authenticate("Bearer " + narrow.secret), { projectId: f.project.id }), { statusCode: 403 });
  const memberToken = await f.tokens.create(f.members[0], { name: "成员", scopes, allProjects: false, projectIds: [f.project.id], expiresInDays: 7 });
  const memberClient = await f.connect(memberToken.secret);
  const uploaded = await f.upload();
  const input = { ...owners(f.admin.id), projectId: f.project.id, requestId: randomUUID(), type: "requirement", title: "隔离验证", attachmentIds: [uploaded.data.attachmentId], description: uploaded.data.markdown };
  await error(memberClient, "create_issue", input, 404);
  await f.database.client.mcpUpload.update({ where: { id: uploaded.data.attachmentId }, data: { expiresAt: new Date(0) } });
  await error(client, "create_issue", input, 410);
  await f.database.client.projectMember.update({ where: { projectId_userId: { projectId: f.project.id, userId: f.members[0].id } }, data: { status: "disabled" } });
  await error(memberClient, "list_project_members", { projectId: f.project.id }, 404);
  await error(memberClient, "get_issue_workflow", { projectId: f.project.id, type: "bug" }, 404);
  f.setMaintenance(true);
  await error(client, "create_release", { projectId: f.project.id, requestId: randomUUID(), name: "v2.0" }, 409);
  assert.equal((await f.upload()).status, 409);
  f.setMaintenance(false);
  const slow = await f.tokens.create(f.admin, { name: "慢上传", scopes, allProjects: true, projectIds: [], expiresInDays: 7 });
  const slowGrant = await call(await f.connect(slow.secret), "create_upload_token", { projectId: f.project.id });
  await f.database.client.mcpToken.update({ where: { id: slow.token.id }, data: { lastUsedAt: null } });
  let uploadRequest;
  const pendingUpload = new Promise((resolve, reject) => {
    uploadRequest = http.request(f.origin + "/api/mcp/projects/" + f.project.id + "/uploads?name=slow.png", {
      method: "POST", headers: { authorization: "Bearer " + slowGrant.uploadToken, "content-type": "image/png", "content-length": png.length, "idempotency-key": randomUUID() },
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, data: Buffer.concat(chunks).toString() }));
    });
    uploadRequest.on("error", reject);
    uploadRequest.write(png.subarray(0, 8));
  });
  t.after(() => uploadRequest.destroy());
  const deadline = Date.now() + 5000;
  while (!(await f.database.client.mcpToken.findUnique({ where: { id: slow.token.id } })).lastUsedAt) {
    assert.ok(Date.now() < deadline, "slow upload must pass initial authentication");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await f.tokens.revoke(f.admin, slow.token.id);
  uploadRequest.end(png.subarray(8));
  assert.equal((await pendingUpload).status, 401, "revocation while body is streaming prevents persistence");
  await f.tokens.revoke(f.admin, f.credential.token.id);
  assert.equal((await f.request("/api/mcp/whoami")).status, 401);
  assert.equal((await f.upload()).status, 401);
  const stored = await f.database.client.mcpToken.findUnique({ where: { id: narrow.token.id } });
  assert.equal(stored.tokenHash.includes(narrow.secret), false);
  assert.equal(JSON.stringify(await f.tokens.list(f.admin)).includes(narrow.secret), false);
  await f.database.client.user.update({ where: { id: f.admin.id }, data: { authVersion: { increment: 1 } } });
  assert.equal((await f.request("/api/mcp/whoami", { secret: narrow.secret })).status, 401);
});

test("temporary upload credentials are project-scoped, expiring, revocable and never authorize MCP", async t => {
  const f = await fixture(t), client = await f.connect();
  const grant = f.uploadCredential;
  assert.match(grant.uploadToken, /^wc_upload_[A-Za-z0-9_-]{43}$/);
  assert.ok(new Date(grant.expiresAt) <= new Date(Date.now() + 86400000));
  assert.ok(new Date(grant.expiresAt) > new Date(Date.now() + 86300000));
  assert.equal((await f.upload(undefined, png, { secret: f.credential.secret })).status, 401, "long-lived credentials must not upload");
  assert.equal((await f.request("/api/mcp/whoami", { secret: grant.uploadToken })).status, 401);
  assert.equal((await f.request("/mcp", { method: "POST", secret: grant.uploadToken, body: "{}", headers: { "content-type": "application/json" } })).status, 401);
  assert.equal((await f.request("/api/account/mcp-tokens", { secret: grant.uploadToken })).status, 401);
  assert.equal((await f.upload(undefined, png, { secret: "wc_upload_" + "a".repeat(43) })).status, 401);
  const otherProject = (await f.projects.create(f.admin, { name: "另一个项目", remoteUrl: "https://example.invalid/other.git" })).project;
  assert.equal((await f.request("/api/mcp/projects/" + otherProject.id + "/uploads?name=shot.png", {
    method: "POST", secret: grant.uploadToken, body: png, headers: { "content-type": "image/png", "idempotency-key": randomUUID() },
  })).status, 403);
  await error(client, "create_upload_token", { projectId: otherProject.id }, 403);
  const stored = await f.database.client.mcpUploadToken.findFirst({ where: { tokenId: f.credential.token.id } });
  assert.equal(stored.tokenHash.includes(grant.uploadToken), false);
  assert.equal(JSON.stringify(await f.tokens.list(f.admin)).includes(grant.uploadToken), false);
  await f.database.client.mcpUploadToken.update({ where: { id: stored.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await f.upload()).status, 401);
  const expiry = new Date(Date.now() + 3600000);
  await f.database.client.mcpToken.update({ where: { id: f.credential.token.id }, data: { expiresAt: expiry } });
  const shorter = await call(client, "create_upload_token", { projectId: f.project.id });
  assert.equal(shorter.expiresAt, expiry.toISOString());
  const uploadId = randomUUID();
  assert.equal((await f.upload(uploadId, png, { secret: shorter.uploadToken })).status, 201);
  const renewed = await call(client, "create_upload_token", { projectId: f.project.id });
  assert.equal((await f.upload(uploadId, png, { secret: renewed.uploadToken })).data.attachmentId, uploadId, "credential renewal preserves upload replay");
  await f.database.client.user.update({ where: { id: f.admin.id }, data: { authVersion: { increment: 1 } } });
  assert.equal((await f.upload(undefined, png, { secret: renewed.uploadToken })).status, 401);

  const memberToken = await f.tokens.create(f.members[0], { name: "权限变化", scopes, allProjects: true, projectIds: [], expiresInDays: 7 });
  const memberClient = await f.connect(memberToken.secret);
  const memberGrant = await call(memberClient, "create_upload_token", { projectId: f.project.id });
  await f.database.client.projectMember.update({ where: { projectId_userId: { projectId: f.project.id, userId: f.members[0].id } }, data: { status: "disabled" } });
  assert.equal((await f.upload(undefined, png, { secret: memberGrant.uploadToken })).status, 404);
  await error(memberClient, "create_upload_token", { projectId: f.project.id }, 404);
  assert.equal(await f.database.client.mcpUpload.count(), 1);
});

test("MCP schemas and skill discovery preserve complete requirement and bug publication", async t => {
  const f = await fixture(t), client = await f.connect(), projectId = f.project.id;
  const tools = (await client.listTools()).tools;
  const toolNames = tools.map(tool => tool.name).sort();
  for (const [name, transport] of [["create_issue", ["projectId", "requestId", "type", "developerId"]], ["update_issue", ["projectId", "requestId", "issueId", "revision"]]]) {
    assert.deepEqual(Object.keys(tools.find(tool => tool.name === name).inputSchema.properties).sort(),
      [...contentFields, ...assignmentFields, "attachmentIds", ...transport].sort(), "MCP fields must match the domain contract");
  }
  const createSchema = tools.find(tool => tool.name === "create_issue").inputSchema;
  for (const field of ["businessOwnerId", "qaOwnerId", "acceptanceOwnerId"]) assert.ok(createSchema.required.includes(field));
  assert.equal(createSchema.properties.acceptanceCriteria.type, "array");
  const release = (await call(client, "create_release", { projectId, requestId: randomUUID(), name: "v2.0", targetDate: "2026-11-30" })).release;
  const identity = await call(client, "whoami");
  assert.equal(identity.runtime.siteOrigin, f.origin);
  assert.equal(identity.runtime.mcpUrl, f.origin + "/mcp");
  assert.equal(identity.skills.name, "web-coding-issue-authoring");
  assert.equal(identity.skills.manifestUrl, f.origin + "/skills/web-coding-issue-authoring/manifest.json");
  const httpIdentity = await f.request("/api/mcp/whoami");
  assert.deepEqual(httpIdentity.data.runtime, identity.runtime);
  assert.deepEqual(httpIdentity.data.skills, identity.skills);
  assert.equal(f.uploadCredential.uploadUrl, f.origin + f.uploadCredential.uploadPath);
  const manifest = await (await fetch(identity.skills.manifestUrl)).json();
  const protocol = await (await fetch(manifest.files.find(file => file.path === "references/mcp-publishing.md").url)).text();
  for (const name of toolNames) assert.ok(protocol.includes(name), "publishing reference explains " + name);
  for (const type of ["requirement", "bug"]) {
    const example = { type, projectId: "<PROJECT_ID>", requestId: "<REQUEST_UUID_V4>", title: "技能协议字段往返 " + type,
      description: "已核验的资料 [原型](attachment:<REFERENCE_ID>)", acceptanceCriteria: ["按编号规则验证结果"],
      reproductionSteps: "1. 打开测试页面\n2. 提交测试数据", expectedResult: "显示已约定结果", actualResult: "观察到测试偏差",
      priority: "high", severity: "major", releaseId: "<RELEASE_ID>", dueDate: "2026-11-20", tags: ["技能测试"],
      reporterId: "<REPORTER_ID>", businessOwnerId: "<BUSINESS_OWNER_ID>", qaOwnerId: "<QA_OWNER_ID>",
      acceptanceOwnerId: "<ACCEPTANCE_OWNER_ID>", watcherIds: ["<WATCHER_ID>"], attachmentIds: ["<REFERENCE_ID>"] };
    const workflow = (await call(client, "get_issue_workflow", { projectId, type: example.type })).workflow;
    const version = workflow.versions.find(row => row.version === workflow.publishedVersion);
    assert.ok(version.definition.nodes.some(node => node.kind === "initial"));
    const replacements = { "<PROJECT_ID>": projectId, "<REQUEST_UUID_V4>": randomUUID(), "<RELEASE_ID>": release.id,
      "<REPORTER_ID>": f.admin.id, "<BUSINESS_OWNER_ID>": f.admin.id, "<QA_OWNER_ID>": f.members[0].id,
      "<ACCEPTANCE_OWNER_ID>": f.members[1].id, "<WATCHER_ID>": f.members[1].id };
    for (const placeholder of example.attachmentIds) {
      const screenshot = placeholder === "<SCREENSHOT_ID>";
      const uploaded = await f.request("/api/mcp/projects/" + projectId + "/uploads?name=" + (screenshot ? "shot.png" : "reference.md"), {
        method: "POST", secret: f.uploadCredential.uploadToken, body: screenshot ? png : Buffer.from("# Reference\nExample fixture"),
        headers: { "content-type": screenshot ? "image/png" : "text/markdown", "idempotency-key": randomUUID() },
      });
      assert.equal(uploaded.status, 201);
      replacements[placeholder] = uploaded.data.attachmentId;
    }
    const input = JSON.parse(JSON.stringify(example).replace(/<[A-Z0-9_]+>/g, placeholder => {
      assert.ok(replacements[placeholder], "known guide placeholder: " + placeholder);
      return replacements[placeholder];
    }));
    const created = await call(client, "create_issue", input);
    const result = await call(client, "get_issue", { projectId, issueId: created.issue.id });
    assert.equal(result.issue.type, input.type);
    for (const field of [...contentFields, ...assignmentFields].filter(field => Object.hasOwn(input, field))) {
      const expected = typeof input[field] === "string" ? input[field].replaceAll("attachment:", "/api/projects/" + projectId + "/files/") : input[field];
      assert.deepEqual(result.issue[field], expected, input.type + " persists " + field);
    }
    assert.equal(result.issue.status, version.definition.nodes.find(node => node.kind === "initial").id);
    assert.equal(result.developmentTask, null);
    assert.deepEqual(result.attachments.map(file => file.id).sort(), input.attachmentIds.toSorted());
    assert.equal((await call(client, "create_issue", input)).issue.id, result.issue.id);
  }
  assert.equal(await f.database.client.projectIssue.count(), 2);
  assert.equal(await f.database.client.developmentTask.count(), 0);
  assert.equal(await f.database.client.run.count(), 0);
});

test("MCP workflow discovery follows publication without leaking drafts or bypassing assignment gates", async t => {
  const f = await fixture(t), client = await f.connect(), projectId = f.project.id;
  const workflows = new SystemWorkflowServices(f.database, new AccountServices(f.database), f.projects);
  const original = (await call(client, "get_issue_workflow", { projectId, type: "bug" })).workflow;
  const before = await call(client, "create_issue", { ...owners(f.admin.id), projectId, requestId: randomUUID(), type: "bug", title: "旧流程事项" });
  const current = (await workflows.readWorkflow("bug", f.admin)).workflow;
  const definition = structuredClone(current.versions.find(version => version.version === current.publishedVersion).definition);
  const initial = definition.nodes.find(node => node.kind === "initial");
  initial.name = "需要先确认的草稿节点";
  initial.allowAssignment = false;
  const saved = (await workflows.saveWorkflow("bug", f.admin, { revision: current.revision, definition })).workflow;
  const unpublished = (await call(client, "get_issue_workflow", { projectId, type: "bug" })).workflow;
  assert.deepEqual(unpublished, original);
  assert.equal(JSON.stringify(unpublished).includes(initial.name), false);
  await workflows.saveWorkflow("bug", f.admin, { revision: saved.revision }, true);
  const published = (await call(client, "get_issue_workflow", { projectId, type: "bug" })).workflow;
  assert.equal(published.publishedVersion, original.publishedVersion + 1);
  assert.deepEqual(published.versions.find(version => version.version === published.publishedVersion).definition, definition);
  const input = { ...owners(f.admin.id), projectId, requestId: randomUUID(), type: "bug", title: "新流程事项", developerId: f.members[0].id };
  await error(client, "create_issue", input, 409);
  assert.equal(await f.database.client.projectIssue.count(), 1, "assignment gate rolls back the entire publication");
  const after = await call(client, "create_issue", { ...input, developerId: undefined });
  const oldRow = await f.database.client.projectIssue.findUnique({ where: { id: before.issue.id } });
  const newRow = await f.database.client.projectIssue.findUnique({ where: { id: after.issue.id } });
  assert.equal(oldRow.workflowVersionId, published.versions.find(version => version.version === published.publishedVersion).id);
  assert.equal(newRow.workflowVersionId, published.versions.find(version => version.version === published.publishedVersion).id);
  assert.equal(await f.database.client.developmentTask.count(), 0);
});

test("MCP dates, tags and personnel permissions follow current Web issue rules", async t => {
  const f = await fixture(t), projectId = f.project.id, member = f.members[0];
  const writeToken = await f.tokens.create(member, { name: "内容编辑", scopes: ["read", "issues.write"], allProjects: false, projectIds: [projectId], expiresInDays: 7 });
  const writer = await f.connect(writeToken.secret);
  const input = { ...owners(member.id), projectId, requestId: randomUUID(), type: "requirement", title: "日期和人员", dueDate: "2028-02-29", tags: [" 日期 ", "日期", "MCP"], reporterId: member.id };
  let result = await call(writer, "create_issue", input);
  assert.equal(result.issue.dueDate, "2028-02-29");
  assert.deepEqual(result.issue.tags, ["日期", "MCP"]);
  await error(writer, "create_issue", { ...input, requestId: randomUUID(), qaOwnerId: f.members[1].id }, 403);
  await error(writer, "create_issue", { ...input, requestId: randomUUID(), watcherIds: [member.id] }, 403);
  const update = { projectId, issueId: result.issue.id, revision: result.issue.revision, requestId: randomUUID(), title: "仅修改标题" };
  result = await call(writer, "update_issue", update);
  assert.equal(result.issue.dueDate, "2028-02-29", "omitted date is preserved");
  assert.deepEqual(result.issue.tags, ["日期", "MCP"], "omitted tags are preserved");
  for (const invalid of [{ dueDate: "2027-02-29" }, { dueDate: "2026-04-31" }, { tags: [" "] }])
    await error(writer, "update_issue", { ...update, revision: result.issue.revision, requestId: randomUUID(), ...invalid }, 400);
  for (const invalid of [{ tags: ["x".repeat(31)] }, { tags: Array(13).fill("x") }, { status: "ready" }, { requestId: "123e4567-e89b-12d3-a456-426614174000" }])
    await error(writer, "update_issue", { ...update, revision: result.issue.revision, requestId: randomUUID(), ...invalid });
  result = await call(writer, "update_issue", { ...update, revision: result.issue.revision, requestId: randomUUID(), dueDate: null, tags: [] });
  assert.equal(result.issue.dueDate, null);
  assert.deepEqual(result.issue.tags, []);
  result = await call(writer, "update_issue", { ...update, revision: result.issue.revision, requestId: randomUUID(), dueDate: "2026-12-01", tags: ["替换"] });
  result = await call(writer, "update_issue", { ...update, revision: result.issue.revision, requestId: randomUUID(), dueDate: "" });
  assert.equal(result.issue.dueDate, null);
  assert.deepEqual(result.issue.tags, ["替换"]);
  await error(writer, "update_issue", { ...update, revision: result.issue.revision, requestId: randomUUID(), qaOwnerId: null });
  const assignmentToken = await f.tokens.create(member, { name: "人员编辑", scopes: ["read", "issues.write", "issues.assign"], allProjects: false, projectIds: [projectId], expiresInDays: 7 });
  const assigner = await f.connect(assignmentToken.secret);
  await f.database.client.projectMember.update({ where: { projectId_userId: { projectId, userId: member.id } }, data: { permissions: ["project.view", "issue.view", "issue.assign"] } });
  await error(assigner, "update_issue", { projectId, issueId: result.issue.id, revision: result.issue.revision, requestId: randomUUID(), qaOwnerId: null });
  const assigned = await call(assigner, "update_issue", { projectId, issueId: result.issue.id, revision: result.issue.revision, requestId: randomUUID(), qaOwnerId: f.members[1].id, watcherIds: [f.members[1].id] });
  assert.equal(assigned.issue.qaOwnerId, f.members[1].id);
  assert.deepEqual(assigned.issue.watcherIds, [f.members[1].id]);
  await error(assigner, "update_issue", { ...update, revision: assigned.issue.revision, requestId: randomUUID(), tags: [] }, 403);
});

test("console token management keeps cookie authentication and CSRF separate from Bearer", async t => {
  const f = await fixture(t);
  let cookie = "", csrf;
  async function browser(path, input, extra = {}) {
    const response = await fetch(f.origin + path, { method: input ? "POST" : "GET",
      headers: { cookie, ...(input ? { "content-type": "application/json", "x-csrf-token": csrf } : {}), ...extra },
      ...(input ? { body: JSON.stringify(input) } : {}) });
    const sessionCookie = response.headers.getSetCookie().find(value => value.startsWith("web_coding_session="));
    if (sessionCookie) cookie = sessionCookie.split(";")[0];
    const data = await response.json();
    if (data.token && typeof data.token === "string") csrf = data.token;
    return { status: response.status, data };
  }
  await browser("/api/auth/session");
  assert.equal((await browser("/api/auth/login", { username: "admin", password: "fixture-password-123" })).status, 200);
  const issuePath = `/api/projects/${f.project.id}/issues`;
  const issue = await browser(issuePath, { ...owners(f.admin.id), type: "bug", title: "误提交的 Bug" });
  assert.equal(issue.status, 201);
  const deletePath = `${issuePath}/${issue.data.id}/delete`, deletion = { revision: issue.data.revision };
  assert.equal((await browser(deletePath, deletion, { "x-csrf-token": "invalid" })).status, 403);
  assert.equal((await f.request(deletePath, { method: "POST", body: JSON.stringify(deletion), headers: { "content-type": "application/json" } })).status, 403);
  assert.equal((await browser(deletePath, deletion)).status, 200);
  assert.equal((await browser(`${issuePath}/${issue.data.id}`)).status, 404);
  const input = { name: "控制台 Token", expiresInDays: 7, scopes: ["read"], allProjects: true, projectIds: [] };
  assert.equal((await browser("/api/account/mcp-tokens", input, { "x-csrf-token": "invalid" })).status, 403);
  const created = await browser("/api/account/mcp-tokens", input);
  assert.equal(created.status, 201);
  assert.match(created.data.secret, /^wc_mcp_/);
  const listed = await browser("/api/account/mcp-tokens");
  assert.equal(listed.status, 200);
  assert.equal(JSON.stringify(listed.data).includes(created.data.secret), false);
  assert.equal((await f.request("/api/account/mcp-tokens")).status, 401, "Bearer cannot manage personal tokens");
  assert.equal((await browser("/api/account/mcp-tokens/" + created.data.token.id + "/revoke", {})).status, 200);
  assert.equal((await f.request("/api/mcp/whoami", { secret: created.data.secret })).status, 401);
});
