const { json } = require("./messages.cjs");
async function serveSystemWorkflows(request, response, url, { services, actor, input }) {
  const system = /^\/api\/system\/workflows\/([^/]+)(?:\/(publish))?$/.exec(url.pathname);
  const project = /^\/api\/projects\/([^/]+)\/issue-workflows\/([^/]+)$/.exec(url.pathname);
  let result;
  if (system) {
    const [, type, action] = system;
    if (request.method === "GET" && !action) result = await services.readWorkflow(type, actor);
    else if (request.method === "POST") result = await services.saveWorkflow(type, actor, input, action === "publish");
    else return false;
  } else if (project && request.method === "GET") result = await services.readPublished(project[1], project[2], actor);
  else return false;
  json(response, 200, result);
  return true;
}
module.exports = { serveSystemWorkflows };
