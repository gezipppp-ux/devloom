const { json } = require("./messages.cjs");

async function serveProjectApi(request, response, url, { projects, actor, input }) {
  const route = /^\/api\/admin\/departments(?:\/([^/]+))?$/.exec(url.pathname);
  if (route) {
    const [, id] = route;
    if (request.method === "GET" && !id) {
      json(response, 200, await projects.departments(actor)); return true;
    }
    if (request.method === "POST") {
      json(response, id ? 200 : 201, await projects.saveDepartment(actor, input, id)); return true;
    }
  }
  if (url.pathname === "/api/project-permissions" && request.method === "GET") {
    json(response, 200, projects.catalog()); return true;
  }
  if (url.pathname === "/api/projects") {
    if (request.method === "GET") { json(response, 200, await projects.list(actor)); return true; }
    if (request.method === "POST") { json(response, 201, await projects.create(actor, input)); return true; }
  }
  const project = /^\/api\/projects\/([^/]+)(?:\/(members)(?:\/([^/]+))?|\/(archive|restore|space|prompts)(\/prepare)?)?$/.exec(url.pathname);
  if (!project) return false;
  const [, id, members, userId, action, prepare] = project;
  if (request.method === "GET") {
    if (action === "prompts" && !prepare) json(response, 200, await projects.promptSettings(id, actor));
    else if (members && !userId) json(response, 200, await projects.members(id, actor));
    else if (action === "space" && !prepare) json(response, 200, await projects.space(id, actor));
    else if (!members && !action) json(response, 200, await projects.read(id, actor));
    else return false;
    return true;
  }
  if (request.method !== "POST") return false;
  if (action === "prompts" && !prepare) json(response, 200, await projects.savePrompts(id, actor, input));
  else if (members) json(response, 200, await projects.saveMember(id, actor, input, userId));
  else if (action === "space" && prepare) json(response, 202, await projects.prepare(id, actor, input));
  else if (action === "archive" || action === "restore") json(response, 200, await projects.archive(id, actor, input, action === "restore"));
  else if (!action) json(response, 200, await projects.update(id, actor, input));
  else return false;
  return true;
}
module.exports = { serveProjectApi };
