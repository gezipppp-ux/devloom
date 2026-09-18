const { RUN_KEY } = require("../domain/run-identity.cjs");
const { WorkspaceServices } = require("../application/workspace-services.cjs");
const { json, body, imageBody } = require("./messages.cjs");
const { sendFile } = require("./assets.cjs");

async function serveApi(request, response, url, context, { token, events }) {
  const { sessions } = context;
  const services = new WorkspaceServices(context);
  if (request.method === "GET" && url.pathname === "/api/repository/git")
    return json(response, 200, services.readRepository());
  if (request.method === "POST" && ["/api/repository/git/fetch", "/api/repository/git/update"].includes(url.pathname))
    return json(response, 200, await services.mutateRepository(url.pathname.endsWith("/fetch") ? "fetch" : "update", await body(request)));
  if (request.method === "GET" && url.pathname === "/api/bootstrap")
    return json(response, 200, { token, ...services.describe() });
  if (request.method === "GET" && url.pathname === "/api/settings/tapd")
    return json(response, 200, services.readTapdSettings());
  if (request.method === "POST" && url.pathname === "/api/settings/tapd")
    return json(response, 200, services.saveTapdSettings(await body(request)));
  if (request.method === "GET" && url.pathname === "/api/settings/prompts")
    return json(response, 200, services.readPromptSettings());
  if (request.method === "POST" && url.pathname === "/api/settings/prompts")
    return json(response, 200, services.savePromptSettings(await body(request)));
  if (request.method === "POST" && url.pathname === "/api/settings/tapd/check")
    return json(
      response,
      200,
      await services.checkTapdSettings(await body(request)),
    );
  if (request.method === "GET" && url.pathname === "/api/settings")
    return json(response, 200, services.readSettings());
  if (request.method === "GET" && url.pathname === "/api/settings/refs")
    return json(response, 200, {
      refs: services.listBaseRefs(url.searchParams.get("repository")),
    });
  if (request.method === "GET" && url.pathname === "/api/models")
    return json(response, 200, {
      models: await services.listModels(),
    });
  if (request.method === "GET" && url.pathname === "/api/execution-options")
    return json(response, 200, await services.executionOptions());
  if (request.method === "POST" && url.pathname === "/api/settings") {
    const input = await body(request);
    return json(response, 200, services.saveSettings(input));
  }
  if (request.method === "GET" && url.pathname === "/api/events")
    return events.connect(request, response, sessions);
  if (request.method === "GET" && url.pathname === "/api/runs")
    return json(response, 200, { runs: sessions.list() });
  if (
    request.method === "GET" &&
    ["/api/stories", "/api/requirements"].includes(url.pathname)
  ) {
    const items = await services.search(
      url.pathname === "/api/stories"
        ? "tapd"
        : url.searchParams.get("channel") || "tapd",
      {
        query: url.searchParams.get("query"),
        workspace: url.searchParams.get("workspace"),
      },
    );
    return json(response, 200, { items });
  }
  if (request.method === "GET" && url.pathname === "/api/users") {
    const users = await services.searchUsers(
      url.searchParams.get("channel") || "tapd",
      {
        query: url.searchParams.get("query"),
        workspace: url.searchParams.get("workspace"),
      },
    );
    return json(response, 200, { users });
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/channels/manual/images"
  )
    return json(response, 201, services.uploadImage(await imageBody(request)));
  if (request.method === "POST" && url.pathname === "/api/runs")
    return json(response, 202, await sessions.start(await body(request)));
  const route = /^\/api\/runs\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
  if (route && RUN_KEY.test(route[1])) {
    const [, key, action] = route;
    if (request.method === "GET" && action === "git")
      return json(response, 200, sessions.readGit(key));
    if (request.method === "POST" && action === "worktree/delete")
      return json(response, 200, await sessions.deleteWorktree(key, await body(request)));
    if (request.method === "GET" && !action)
      return json(response, 200, await sessions.view(key));
    if (request.method === "GET" && action === "history")
      return json(
        response,
        200,
        await sessions.history(key, url.searchParams.get("cursor")),
      );
    if (request.method === "GET" && /^images\/\d+$/.test(action || "")) {
      const file = services.imagePath(key, action.split("/")[1]);
      sendFile(response, file, "private, max-age=300");
      return;
    }
    if (request.method === "POST" && action === "message-images")
      return json(
        response,
        201,
        await sessions.uploadMessageImage(key, await imageBody(request)),
      );
    if (
      request.method === "GET" &&
      /^message-images\/[^/]+$/.test(action || "")
    ) {
      sendFile(
        response,
        sessions.messageImagePath(key, action.split("/")[1]),
        "private, max-age=300",
      );
      return;
    }
    if (request.method === "POST" && action === "messages") {
      const input = await body(request);
      return json(
        response,
        202,
        await sessions.send(key, input.text, input.images),
      );
    }
    if (request.method === "POST" && action === "metadata")
      return json(
        response,
        200,
        sessions.updateTaskMetadata(key, await body(request)),
      );
    if (request.method === "POST" && action === "execution-settings")
      return json(
        response,
        200,
        await sessions.updateExecutionSettings(key, await body(request)),
      );
    if (request.method === "POST" && action === "interrupt")
      return json(response, 202, await sessions.interrupt(key));
    if (request.method === "POST" && action === "responses") {
      const input = await body(request);
      await sessions.respond(key, input.requestId, input);
      return json(response, 200, { ok: true });
    }
  }
  return json(response, 404, { error: "接口不存在" });
}

module.exports = { serveApi };
