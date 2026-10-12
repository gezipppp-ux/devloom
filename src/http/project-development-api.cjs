const { json } = require("./messages.cjs");

async function serveProjectDevelopment(request, response, url, { services, actor, input }) {
  const route = /^\/api\/projects\/([^/]+)\/tasks(?:\/([^/]+))?(?:\/(.*))?$/.exec(url.pathname);
  if (!route) return false;
  const [, projectId, id, action] = route;
  const send = (status, value) => { json(response, status, value); return true; };
  if (!id && request.method === "GET") return send(200, await services.list(projectId, actor, Object.fromEntries(url.searchParams)));
  if (!id && request.method === "POST") return send(201, await services.create(projectId, actor, input));
  if (id && !action && request.method === "GET") return send(200, await services.read(projectId, id, actor));
  if (id && !action && request.method === "POST") return send(200, await services.update(projectId, id, actor, input));
  if (id && action === "start" && request.method === "POST") return send(202, await services.start(projectId, id, actor, input));
  if (id && ["complete", "cancel"].includes(action) && request.method === "POST") return send(200, await services.finish(projectId, id, actor, input, action === "complete" ? "completed" : "cancelled"));
  if (id && action === "issues" && request.method === "POST") return send(200, await services.append(projectId, id, actor, input));
  const addition = /^additions\/([^/]+)\/continue$/.exec(action || "");
  if (id && addition && request.method === "POST") return send(202, await services.continueAddition(projectId, id, actor, addition[1]));
  return false;
}

module.exports = { serveProjectDevelopment };
