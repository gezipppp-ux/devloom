const { json } = require("./messages.cjs");
async function serveWorkbench(request, response, url, { services, actor }) {
  const route = /^\/api\/workbench\/(issues|tasks|deliveries)$/.exec(url.pathname);
  if (!route || request.method !== "GET") return false;
  json(response, 200, await services.list(route[1], actor, Object.fromEntries(url.searchParams)));
  return true;
}
module.exports = { serveWorkbench };
