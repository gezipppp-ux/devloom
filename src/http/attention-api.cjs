const { json } = require("./messages.cjs");
async function serveAttention(request, response, url, { services, actor }) {
  if (url.pathname !== "/api/workbench/attention" || request.method !== "GET") return false;
  json(response, 200, await services.list(actor));
  return true;
}
module.exports = { serveAttention };
