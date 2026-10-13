const { RUN_KEY } = require("../domain/run-identity.cjs");
const { WorkspaceServices } = require("../application/workspace-services.cjs");
const { json, body, imageBody } = require("./messages.cjs");
const { sendFile } = require("./assets.cjs");
const { accountError } = require("../domain/account.cjs");

async function readApiBody(request, url) {
  const pathname = url.pathname.replace(
    /^\/api\/workspaces\/[^/]+(?=\/)/,
    "/api",
  );
  const emptyAction =
    pathname === "/api/auth/logout" ||
    /^\/api\/runs\/[^/]+\/interrupt$/.test(pathname);
  if (
    emptyAction &&
    !request.headers["transfer-encoding"] &&
    Number(request.headers["content-length"] || 0) === 0
  )
    return {};
  const imageUpload =
    /^\/api\/(?:channels\/manual\/images|runs\/[^/]+\/message-images)$/.test(
      pathname,
    );
  const projectFile = /^\/api\/projects\/[^/]+\/(?:issues|assets)\/[^/]+\/files$/.test(pathname);
  if (request.method === "POST" && /^\/api\/projects\/[^/]+\/issues(?:\/[^/]+)?$/.test(pathname)) return body(request, 30 * 1024 * 1024);
  return imageUpload || projectFile ? (await imageBody(request)) : (await body(request));
}

async function serveApi(
  request,
  response,
  url,
  context,
  { token, events, authorization, accountSettings, input },
) {
  /** @type {import('../application/session-manager.cjs').SessionManager} */
  const sessions = context.sessions;
  const services = new WorkspaceServices(context);
  if (request.method === "GET" && url.pathname === "/api/repository/git")
    return json(response, 200, (await services.readRepository()));
  if (
    request.method === "POST" &&
    ["/api/repository/git/fetch", "/api/repository/git/update"].includes(
      url.pathname,
    )
  )
    return json(
      response,
      200,
      await services.mutateRepository(
        url.pathname.endsWith("/fetch") ? "fetch" : "update",
        input,
      ),
    );
  if (request.method === "GET" && url.pathname === "/api/bootstrap")
    return json(response, 200, { token, ...(await services.describe()) });
  if (request.method === "GET" && url.pathname === "/api/settings/prompts")
    return json(response, 200, (await services.readPromptSettings()));
  if (request.method === "POST" && url.pathname === "/api/settings/prompts")
    return json(response, 200, (await services.savePromptSettings(input)));
  if (request.method === "GET" && url.pathname === "/api/settings")
    return json(response, 200, (await services.readSettings()));
  if (request.method === "GET" && url.pathname === "/api/settings/branches")
    return json(response, 200, {
      branches: (await services.listBaseBranches()),
    });
  if (request.method === "GET" && url.pathname === "/api/models")
    return json(response, 200, {
      models: await services.listModels(),
    });
  if (request.method === "GET" && url.pathname === "/api/execution-options")
    return json(response, 200, await services.executionOptions());
  if (request.method === "POST" && url.pathname === "/api/settings") {
    return json(response, 200, (await services.saveSettings(input)));
  }
  if (request.method === "GET" && url.pathname === "/api/events")
    return events.connect(request, response, sessions, authorization);
  if (request.method === "GET" && url.pathname === "/api/runs")
    return json(response, 200, { runs: (await sessions.list({ archived: url.searchParams.get("archived") === "true" })) });
  if (
    request.method === "GET" &&
    url.pathname === "/api/requirements"
  ) {
    const authorizeSearch = async () => {
      if (authorization && !(await authorization.authorize("issue.view")))
        throw accountError("没有查看项目需求的权限。", 403);
    };
    await authorizeSearch();
    const items = await services.search(
      url.searchParams.get("channel") || "manual",
      {
        query: url.searchParams.get("query"),
        workspace: url.searchParams.get("workspace"),
      },
    );
    await authorizeSearch();
    return json(response, 200, { items });
  }
  if (request.method === "GET" && url.pathname === "/api/users") {
    const users = await services.searchUsers(
      url.searchParams.get("channel") || "manual",
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
    return json(response, 201, (await services.uploadImage(input)));
  if (request.method === "POST" && url.pathname === "/api/runs") {
    return json(response, 202, await services.startRun(input, accountSettings));
  }
  const route = /^\/api\/runs\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
  if (route && RUN_KEY.test(route[1])) {
    const [, key, action] = route;
    if (request.method === "POST" && action === "requirements/continue")
      return json(response, 202, await sessions.requirements.continue(key, input.id));
    if (request.method === "GET" && /^addition-images\/[^/]+\/\d+$/.test(action || "")) {
      const [, id, index] = action.split("/");
      sendFile(response, (await services.additionImagePath(key, id, index)), "private, no-store");
      return;
    }
    if (request.method === "GET" && action === "files")
      return json(response, 200, await sessions.listFiles(key, url.searchParams.get("scope") || "task"));
    if (request.method === "GET" && action === "file")
      return json(response, 200, await sessions.readFile(key, url.searchParams.get("path"), url.searchParams.get("scope") || "task"));
    if (request.method === "GET" && action === "git")
      return json(response, 200, (await sessions.readGit(key)));
    if (request.method === "POST" && action === "worktree/delete")
      return json(response, 200, await sessions.deleteWorktree(key, input));
    if (request.method === "GET" && !action)
      return json(response, 200, await sessions.view(key));
    if (request.method === "GET" && action === "history")
      return json(
        response,
        200,
        await sessions.history(key, url.searchParams.get("cursor")),
      );
    if (request.method === "GET" && /^images\/\d+$/.test(action || "")) {
      const file = (await services.imagePath(key, action.split("/")[1]));
      sendFile(response, file, "private, no-store");
      return;
    }
    if (request.method === "POST" && action === "message-images")
      return json(response, 201, await sessions.uploadMessageImage(key, input));
    if (
      request.method === "GET" &&
      /^message-images\/[^/]+$/.test(action || "")
    ) {
      sendFile(
        response,
        (await sessions.messageImagePath(key, action.split("/")[1])),
        "private, no-store",
      );
      return;
    }
    if (request.method === "POST" && action === "messages") {
      return json(
        response,
        202,
        await sessions.send(key, input.text, input.images),
      );
    }
    if (request.method === "POST" && action === "metadata")
      return json(response, 200, (await sessions.updateTaskMetadata(key, input)));
    if (request.method === "POST" && action === "title")
      return json(response, 200, (await sessions.updateTitle(key, input.title)));
    if (request.method === "POST" && action === "archive")
      return json(response, 200, await sessions.archive(key));
    if (request.method === "POST" && action === "restore")
      return json(response, 200, await sessions.restore(key));
    if (request.method === "POST" && action === "delete")
      return json(response, 200, await sessions.deleteSession(key, input));
    if (request.method === "POST" && action === "execution-settings")
      return json(
        response,
        200,
        await sessions.updateExecutionSettings(key, input),
      );
    if (request.method === "POST" && action === "interrupt")
      return json(response, 202, await sessions.interrupt(key));
    if (request.method === "POST" && action === "responses") {
      await sessions.respond(key, input.requestId, input);
      return json(response, 200, { ok: true });
    }
  }
  return json(response, 404, { error: "接口不存在" });
}

module.exports = { readApiBody, serveApi };
