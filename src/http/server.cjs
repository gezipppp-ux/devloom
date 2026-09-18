const path = require("node:path");
const http = require("node:http");
const { randomBytes } = require("node:crypto");
const { root, dataRoot } = require("../config/runtime.cjs");
const { Workspaces } = require("../application/workspaces.cjs");
const { SystemServices } = require("../application/system-services.cjs");
const { json, body } = require("./messages.cjs");
const { serveApi } = require("./api.cjs");
const { serveStatic } = require("./assets.cjs");
const { createEventStream } = require("./events.cjs");
const {
  validateListenHost,
  httpOrigin,
  requestOrigin,
} = require("./origin.cjs");

function createWebServer({
  host = "127.0.0.1",
  configFile,
  manager,
  channels = manager?.channels,
  workspaces = new Workspaces(),
  staticDirectory = path.join(root, "web", "dist"),
  pageHandler = (request, response, url) =>
    serveStatic(request, response, url, staticDirectory),
} = {}) {
  validateListenHost(host);
  const token = randomBytes(32).toString("hex");
  const events = createEventStream();
  const systemServices = new SystemServices(
    workspaces.directory ? path.dirname(workspaces.directory) : dataRoot,
  );
  let closing = false;
  let closePromise;
  const server = http.createServer(async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
    );
    if (closing) return json(response, 503, { error: "服务正在关闭。" });
    const origin = requestOrigin(request);
    if (!origin)
      return json(response, 403, {
        error: "仅允许通过服务端 IP 同源访问，请检查访问地址和端口。",
      });
    try {
      const url = new URL(request.url, origin);
      if (url.origin !== origin)
        return json(response, 403, { error: "请求地址必须与服务地址同源。" });
      if (
        request.method === "POST" &&
        request.headers["x-tapd-token"] !== token
      )
        return json(response, 403, { error: "页面令牌失效，请刷新页面。" });
      if (
        !manager &&
        request.method === "GET" &&
        url.pathname === "/api/bootstrap"
      )
        return json(response, 200, { token, workspaces: workspaces.list() });
      if (url.pathname === "/api/workspaces") {
        if (request.method === "GET")
          return json(response, 200, { workspaces: workspaces.list() });
        if (request.method === "POST")
          return json(response, 201, workspaces.save(await body(request)));
      }
      if (url.pathname === "/api/system/settings") {
        if (request.method === "GET")
          return json(response, 200, systemServices.readSettings());
        if (request.method === "POST")
          return json(response, 200, systemServices.saveSettings(await body(request)));
      }
      if (request.method === "GET" && url.pathname === "/api/system/directories")
        return json(response, 200, await systemServices.listDirectories({
          path: url.searchParams.get("path"),
          offset: url.searchParams.get("offset"),
          limit: url.searchParams.get("limit"),
        }));
      const scoped = /^\/api\/workspaces\/([^/]+)(\/.*)?$/.exec(url.pathname);
      let context;
      if (scoped) {
        const id = scoped[1];
        if (!scoped[2] && request.method === "POST")
          return json(response, 200, workspaces.save(await body(request), id));
        context = workspaces.get(id);
        url.pathname = `/api${scoped[2] || "/bootstrap"}`;
      } else if (manager) context = { configFile, channels, sessions: manager };
      else if (url.pathname.startsWith("/api/"))
        return json(response, 400, { error: "请先选择工作区。" });
      if (url.pathname.startsWith("/api/"))
        return await serveApi(request, response, url, context, {
          token,
          events,
        });
      return await pageHandler(request, response, url);
    } catch (error) {
      if (!response.headersSent)
        json(response, error.code === "ENOENT" ? 404 : 400, {
          error: error.message,
        });
      else response.end();
    }
  });
  return {
    server,
    sessions: manager,
    workspaces,
    async listen(port = 4317) {
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          resolve();
        });
      });
      const bound = server.address();
      const address =
        bound.address === "0.0.0.0"
          ? "127.0.0.1"
          : bound.address === "::"
            ? "::1"
            : bound.address;
      return httpOrigin(address, bound.port);
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      // Stop accepting requests before closing managers: EventSource may
      // reconnect while a manager is still waiting for an interrupted turn.
      const stopped = new Promise((resolve, reject) => {
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
          else resolve();
        });
      });
      events.close();
      closePromise = Promise.allSettled([
        stopped,
        Promise.resolve().then(() => manager?.close()),
        Promise.resolve().then(() => workspaces.close()),
      ]).then((results) => {
        const failure = results.find((result) => result.status === "rejected");
        if (failure) throw failure.reason;
      });
      return closePromise;
    },
  };
}

module.exports = { createWebServer };
