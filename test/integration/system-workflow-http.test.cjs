const test = require("node:test");
const assert = require("node:assert/strict");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { createWebServer } = require("../../src/http/server.cjs");

test("system workflow HTTP is administrator-only, hides drafts from projects and removes old project routes", async t => {
  const database = await initializeTestDatabase(t, temporary(t));
  const accounts = new AccountServices(database);
  const password = "fixture-password-only";
  const admin = await accounts.create({ username: "admin", password }, null, true);
  const app = createWebServer({ database });
  t.after(() => app.close());
  const origin = await app.listen(0);
  const grants = ["project.view", "project.configure", "project.members.manage", "issue.view", "issue.create", "issue.transition", "issue.accept"];
  const { department } = await app.projects.saveDepartment(admin, { name: "协作", permissions: grants });
  const member = await accounts.create({ username: "owner", password, departmentId: department.id }, admin);
  await accounts.store.update(member.id, { must_change_password: 0 });
  const { project } = await app.projects.create(admin, { name: "流程项目", remoteUrl: "https://example.invalid/workflow.git" });
  await app.projects.saveMember(project.id, admin, { userId: member.id, permissions: grants });
  await app.projects.update(project.id, admin, { revision: project.revision, ownerUserId: member.id });

  function client() {
    let cookie = "", token = "";
    return {
      async request(route, input, headers = {}) {
        const response = await fetch(origin + route, { method: input === undefined ? "GET" : "POST",
          headers: { cookie, "x-tapd-token": token, ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers },
          ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
        const saved = response.headers.get("set-cookie");
        if (saved) cookie = saved.split(";", 1)[0];
        const data = await response.json();
        if (data.token) token = data.token;
        return { status: response.status, data };
      },
      async login(username) {
        await this.request("/api/auth/session");
        assert.equal((await this.request("/api/auth/login", { username, password })).status, 200);
      },
    };
  }
  const administrator = client(), owner = client(), anonymous = client();
  const endpoint = "/api/system/workflows/requirement";
  assert.equal((await anonymous.request(endpoint)).status, 401);
  await administrator.login("admin"); await owner.login("owner");
  const current = await administrator.request(endpoint);
  assert.equal(current.status, 200, JSON.stringify(current.data));
  const { workflow } = current.data;
  for (const [url, input] of [[endpoint, undefined], [endpoint, { revision: workflow.revision, definition: workflow.draft }], [endpoint + "/publish", { revision: workflow.revision }]]) {
    assert.equal((await owner.request(url, input)).status, 403, "project owner permissions never authorize system workflow management");
  }
  assert.equal((await administrator.request(endpoint, { revision: workflow.revision, definition: workflow.draft }, { "x-tapd-token": "invalid" })).status, 403);
  const draft = structuredClone(workflow.draft);
  draft.nodes[0].name = "未发布的系统草稿";
  const saved = await administrator.request(endpoint, { revision: workflow.revision, definition: draft });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const published = await owner.request(`/api/projects/${project.id}/issue-workflows/requirement`);
  assert.equal(published.status, 200, JSON.stringify(published.data));
  assert.doesNotMatch(JSON.stringify(published.data), /未发布的系统草稿|"draft"/);
  for (const input of [undefined, { revision: 1, definition: draft }])
    assert.equal((await administrator.request(`/api/projects/${project.id}/workflows/requirement`, input)).status, 404);
  const catalog = (await administrator.request("/api/project-permissions")).data;
  assert.doesNotMatch(JSON.stringify(catalog), /workflow\.manage/);
  assert.equal((await owner.request(`/api/projects/${project.id}/issue-workflows/requirement`, { definition: draft })).status, 404);
  assert.equal((await administrator.request(endpoint + "/publish", { revision: saved.data.workflow.revision })).status, 200);
  const latest = await owner.request(`/api/projects/${project.id}/issue-workflows/requirement`);
  assert.match(JSON.stringify(latest.data), /未发布的系统草稿/);
  assert.doesNotMatch(JSON.stringify(latest.data), /"draft"/);
  await database.client.user.update({ where: { id: admin.id }, data: { role: "member" } });
  assert.equal((await administrator.request(endpoint)).status, 403, "current administrator role is rechecked using persisted identity");
});
