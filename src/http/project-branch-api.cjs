const { json } = require("./messages.cjs");

async function serveProjectBranches(request, response, url, { services, actor }) {
  const match = /^\/api\/projects\/([^/]+)\/branches$/.exec(url.pathname);
  if (!match || request.method !== "GET") return false;
  json(response, 200, await services.list(match[1], actor));
  return true;
}

module.exports = { serveProjectBranches };
