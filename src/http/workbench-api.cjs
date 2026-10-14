const { json } = require("./messages.cjs");
async function serveWorkbench(request, response, url, { services, actor }) {
  if (request.method === "GET" && url.pathname === "/api/workbench/actions") { json(response, 200, await services.actions(actor, Object.fromEntries(url.searchParams))); return true; }
  if (request.method === "GET" && url.pathname === "/api/workbench/recent-projects") {
    json(response, 200, await services.recentProjects(actor)); return true;
  }
  const activity = /^\/api\/projects\/([^/]+)\/activity$/.exec(url.pathname);
  if (request.method === "GET" && activity) {
    json(response, 200, await services.activity(activity[1], actor)); return true;
  }
  const route = /^\/api\/workbench\/(issues|tasks|deliveries)$/.exec(url.pathname);
  if (!route || request.method !== "GET") return false;
  json(response, 200, await services.list(route[1], actor, Object.fromEntries(url.searchParams)));
  return true;
}
module.exports = { serveWorkbench };
