const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const permissions = require("../../shared/project-permissions.json");

async function seedProjectDepartment(database, username = "admin") {
  const department = await database.client.department.create({ data: { name: "Development fixtures", permissions: permissions.map(item => item.id) } });
  await database.client.user.update({ where: { username }, data: { departmentId: department.id } });
  return department;
}

async function prepareHttpProject(request, { name, remoteUrl, gitAccountId }) {
  const call = async (url, body) => {
    const result = await request(url, body);
    assert.ok(result.status >= 200 && result.status < 300, `${url}: ${JSON.stringify(result)}`);
    return result.data;
  };
  const session = await call("/api/auth/session");
  const project = await call("/api/projects", { name, remoteUrl });
  await call(`/api/projects/${project.project.id}/members/${session.user.id}`, {
    permissions: permissions.filter(item => item.scope !== "department").map(item => item.id), revision: project.membership.revision,
  });
  const accepted = await request(`/api/projects/${project.project.id}/space/prepare`, { gitAccountId, requestId: randomUUID() });
  assert.equal(accepted.status, 202, JSON.stringify(accepted));
  let space = accepted.data.space;
  const deadline = Date.now() + 20000;
  while (space.status === "preparing" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 30));
    space = (await call(`/api/projects/${project.project.id}/space`)).space;
  }
  assert.equal(space.status, "ready", JSON.stringify(space));
  return { id: space.workspaceId, name, projectId: project.project.id };
}
module.exports = { seedProjectDepartment, prepareHttpProject };
