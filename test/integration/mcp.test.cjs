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
const { createWebServer } = require("../../src/http/server.cjs");
const permissions = require("../../shared/project-permissions.json");
const scopes = require("../../shared/mcp-scopes.json").map(row => row.id);

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
    method: "POST", body: bytes, headers: { "content-type": "image/png", "idempotency-key": id }, ...options,
  });
  async function connect(secret = credential.secret) {
    const client = new Client({ name: "fixture-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + "/mcp"), { requestInit: { headers: { authorization: "Bearer " + secret } } }));
    t.after(() => client.close());
    return client;
  }
  return { database, admin, members, projects, project, tokens, credential, origin, request, upload, connect, setMaintenance: value => { maintenance = value; } };
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

test("MCP client publishes images, release and assignment atomically with replay and conflict recovery", async t => {
  const f = await fixture(t), client = await f.connect();
  const projectId = f.project.id;
  const listed = await client.listTools();
  assert.ok(listed.tools.some(tool => tool.name === "create_issue"));
  assert.equal((await call(client, "whoami")).user.id, f.admin.id);
  assert.deepEqual((await call(client, "list_projects")).items.map(row => row.id), [projectId]);
  const members = (await call(client, "list_project_members", { projectId, assignableOnly: true })).items;
  assert.equal(members.length, 2);
  const releaseInput = { requestId: randomUUID(), projectId, name: "v1.2.3" };
  const release = await call(client, "create_release", releaseInput);
  assert.equal((await call(client, "create_release", releaseInput)).reused, true);
  await error(client, "create_release", { ...releaseInput, name: "v1.2.4" }, 409);
  assert.equal((await call(client, "list_releases", { status: "all" })).items[0].id, release.release.id);
  const uploaded = await f.upload();
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded));
  const fileId = uploaded.data.attachmentId;
  assert.equal((await f.upload(fileId)).data.attachmentId, fileId);
  assert.equal((await f.upload(fileId, Buffer.concat([png, Buffer.from("changed")]))).status, 409);
  const input = { projectId, requestId: randomUUID(), type: "bug", title: "截图缺陷", description: "截图\n" + uploaded.data.markdown,
    releaseId: release.release.id, attachmentIds: [fileId], assigneeId: f.members[0].id, participantIds: [f.members[1].id] };
  const published = await call(client, "create_issue", input);
  assert.equal(published.issue.assigneeId, f.members[0].id);
  assert.equal(published.developmentTask.status, "planned");
  assert.match(published.issue.description, /\/api\/projects\/.*\/files\//);
  assert.equal(published.attachments[0].id, fileId);
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
    taskRevision: detail.developmentTask.revision, requestId: randomUUID(), assigneeId: f.members[1].id });
  assert.equal(reassigned.issue.assigneeId, f.members[1].id);
  const update = { projectId, issueId: detail.issue.id, revision: reassigned.issue.revision, requestId: randomUUID(), title: "修正缺陷" };
  const updated = await call(client, "update_issue", update);
  assert.equal(updated.issue.title, update.title);
  assert.equal((await call(client, "update_issue", update)).reused, true);
  await error(client, "update_issue", { ...update, requestId: randomUUID() }, 409);
  assert.equal((await call(client, "search_issues", { projectId, query: "修正" })).items.length, 1);
  const anotherUpload = await f.upload();
  const bad = { ...input, requestId: randomUUID(), attachmentIds: [anotherUpload.data.attachmentId], description: anotherUpload.data.markdown, assigneeId: randomUUID() };
  await error(client, "create_issue", bad);
  assert.equal(await f.database.client.projectIssue.count(), 1);
  assert.equal((await f.database.client.mcpUpload.findUnique({ where: { id: anotherUpload.data.attachmentId } })).issueId, null);
  await error(client, "create_issue", { ...input, requestId: randomUUID() }, 409, "bound files cannot be attached to another issue");
  const concurrentInput = { projectId, requestId: randomUUID(), type: "requirement", title: "并发发布", description: "两个相同请求" };
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
  assert.equal((await f.upload(randomUUID(), Buffer.from("<html>fake image</html>"))).status, 400);
  assert.equal((await f.upload(randomUUID(), Buffer.alloc(10 * 1024 * 1024 + 1))).status, 400);
  const otherProject = (await f.projects.create(f.admin, { name: "未授权项目", remoteUrl: "https://example.invalid/other.git" })).project;
  await error(client, "get_issue", { projectId: otherProject.id, issueId: randomUUID() }, 403);
  const narrow = await f.tokens.create(f.admin, { name: "只读", scopes: ["read"], allProjects: true, projectIds: [], expiresInDays: 7 });
  const reader = await f.connect(narrow.secret);
  assert.equal((await reader.listTools()).tools.some(tool => tool.name === "create_issue"), false);
  assert.equal((await f.upload(undefined, png, { secret: narrow.secret })).status, 403);
  const memberToken = await f.tokens.create(f.members[0], { name: "成员", scopes, allProjects: false, projectIds: [f.project.id], expiresInDays: 7 });
  const memberClient = await f.connect(memberToken.secret);
  const uploaded = await f.upload();
  const input = { projectId: f.project.id, requestId: randomUUID(), type: "requirement", title: "隔离验证", attachmentIds: [uploaded.data.attachmentId], description: uploaded.data.markdown };
  await error(memberClient, "create_issue", input, 404);
  await f.database.client.mcpUpload.update({ where: { id: uploaded.data.attachmentId }, data: { expiresAt: new Date(0) } });
  await error(client, "create_issue", input, 410);
  await f.database.client.projectMember.update({ where: { projectId_userId: { projectId: f.project.id, userId: f.members[0].id } }, data: { status: "disabled" } });
  await error(memberClient, "list_project_members", { projectId: f.project.id }, 404);
  f.setMaintenance(true);
  await error(client, "create_release", { projectId: f.project.id, requestId: randomUUID(), name: "v2.0" }, 409);
  assert.equal((await f.upload()).status, 409);
  f.setMaintenance(false);
  const slow = await f.tokens.create(f.admin, { name: "慢上传", scopes, allProjects: true, projectIds: [], expiresInDays: 7 });
  let uploadRequest;
  const pendingUpload = new Promise((resolve, reject) => {
    uploadRequest = http.request(f.origin + "/api/mcp/projects/" + f.project.id + "/uploads?name=slow.png", {
      method: "POST", headers: { authorization: "Bearer " + slow.secret, "content-type": "image/png", "content-length": png.length, "idempotency-key": randomUUID() },
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
