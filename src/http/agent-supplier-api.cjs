const { json } = require("./messages.cjs");
async function serveAgentSuppliers(request, response, url, { services, actor, input, authorize }) {
  const route = /^\/api\/system\/agent-suppliers(?:\/([^/]+))?(?:\/(activate|delete|duplicate))?$/.exec(url.pathname);
  if (!route) return false;
  const [, id, action] = route; let result;
  if (request.method === "GET" && !id) result = await services.list(actor, url.searchParams.get("agentType") || "codex");
  else if (request.method === "POST") {
    if (!action && ["models", "check"].includes(id)) result = await services.request(actor, input, id, authorize);
    else if (action === "activate") result = await services.activate(actor, id, input, authorize);
    else if (action === "delete") result = await services.remove(actor, id, input, authorize);
    else if (action === "duplicate") result = await services.duplicate(actor, id);
    else result = await services.save(actor, input, id, authorize);
  } else return false;
  json(response, 200, result); return true;
}
module.exports = { serveAgentSuppliers };
