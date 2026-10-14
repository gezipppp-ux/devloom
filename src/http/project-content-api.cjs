const { json } = require("./messages.cjs");

async function serveProjectContent(request, response, url, { services, actor, input }) {
  const reviewers = /^\/api\/projects\/([^/]+)\/reviewers$/.exec(url.pathname);
  if (reviewers && request.method === "GET") { json(response, 200, await services.reviewers(reviewers[1], actor)); return true; }
  const collection = /^\/api\/projects\/([^/]+)\/deliveries$/.exec(url.pathname);
  if (collection && request.method === "POST") { json(response, 201, await services.addDeliverable(collection[1], actor, input)); return true; }
  const delivery = /^\/api\/projects\/([^/]+)\/deliveries\/([^/]+)(\/(review|start|assign))?$/.exec(url.pathname);
  if (delivery) {
    if (request.method === "GET" && !delivery[3]) { json(response, 200, await services.readDeliverable(delivery[1], delivery[2], actor)); return true; }
    if (request.method === "POST" && delivery[3] === "/start") { json(response, 200, await services.beginDelivery(delivery[1], delivery[2], actor, input)); return true; }
    if (request.method === "POST" && delivery[3] === "/assign") { json(response, 200, await services.reassignDelivery(delivery[1], delivery[2], actor, input)); return true; }
    if (request.method === "POST" && delivery[3] === "/review") { json(response, 200, await services.reviewDeliverable(delivery[1], delivery[2], actor, input)); return true; }
    return false;
  }
  const route = /^\/api\/projects\/([^/]+)\/(issues|assets|files)(?:\/([^/]+))?(?:\/(.*))?$/.exec(url.pathname);
  if (!route) return false;
  const [, projectId, resource, id, action] = route;
  const query = Object.fromEntries(url.searchParams);
  const send = (status, value) => { json(response, status, value); return true; };
  if (resource === "files" && id && !action && request.method === "GET") {
    const file = await services.downloadFile(projectId, id, actor);
    const inline = query.inline === "1" && file.previewMimeType;
    response.writeHead(200, { "content-type": inline || file.mimeType, "content-length": file.size, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)}` });
    response.end(file.data);
    return true;
  }
  if (!["issues", "assets"].includes(resource)) return false;
  if (!id) {
    if (request.method === "GET") return send(200, resource === "issues" ? await services.listIssues(projectId, actor, query) : await services.listAssets(projectId, actor, query));
    if (request.method === "POST") return send(201, resource === "issues" ? await services.createIssue(projectId, actor, input) : await services.saveAsset(projectId, null, actor, input));
  }
  if (id && !action) {
    if (request.method === "GET") return send(200, resource === "issues" ? await services.readIssue(projectId, id, actor) : await services.readAsset(projectId, id, actor));
    if (request.method === "POST") return send(200, resource === "issues" ? await services.updateIssue(projectId, id, actor, input) : await services.saveAsset(projectId, id, actor, input));
  }
  if (id && action === "files") {
    if (request.method === "GET") return send(200, await services.listFiles(projectId, resource, id, actor, query));
    if (request.method === "POST") return send(201, await services.uploadFile(projectId, resource, id, actor,
      { name: query.name, mimeType: request.headers["content-type"], data: input }));
  }
  if (resource === "issues" && id) {
    if (request.method === "POST" && action === "step/start") return send(200, await services.startIssueStep(projectId, id, actor, input));
    if (request.method === "GET" && ["comments", "deliverables", "history"].includes(action)) return send(200, await services.children(projectId, id, actor, action, query));
    if (request.method === "POST" && action === "comments") return send(201, await services.addComment(projectId, id, actor, input));
    if (request.method === "POST" && action === "transition") return send(200, await services.transitionIssue(projectId, id, actor, input));
  }
  if (resource === "assets" && id) {
    if (request.method === "GET" && action === "history") return send(200, await services.assetHistory(projectId, id, actor, query));
    if (request.method === "POST" && action === "secret") return send(200, await services.readSecret(projectId, id, actor));
  }
  return false;
}

module.exports = { serveProjectContent };
