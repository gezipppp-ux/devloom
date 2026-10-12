const { json } = require("./messages.cjs");
async function serveProjectLifecycle(request, response, url, { services, actor, input }) {
  const route = /^\/api\/projects\/([^/]+)\/releases(?:\/([^/]+))?(?:\/(archive|restore))?$/.exec(url.pathname);
  if (!route) return false;
  const [, projectId, id, action] = route;
  let result;
  if (request.method === "GET" && !id) result = await services.listReleases(projectId, actor, Object.fromEntries(url.searchParams));
  else if (request.method === "POST" && !action) result = await services.saveRelease(projectId, id, actor, input);
  else if (request.method === "POST" && id && action) result = await services.archiveRelease(projectId, id, actor, input, action === "archive");
  else return false;
  json(response, request.method === "POST" && !id ? 201 : 200, result);
  return true;
}
module.exports = { serveProjectLifecycle };
