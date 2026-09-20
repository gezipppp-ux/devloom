const path = require("node:path");
const { PassThrough } = require("node:stream");
const { randomBytes } = require("node:crypto");
const Fastify = require("fastify");
const cookie = require("@fastify/cookie");
const session = require("@fastify/session");
const csrf = require("@fastify/csrf-protection");
const rateLimit = require("@fastify/rate-limit");
const { root, dataRoot } = require("../config/runtime.cjs");
const { WorkspaceManager } = require("../application/workspace-manager.cjs");
const { WorkspaceCloneManager } = require("../application/workspace-clone-manager.cjs");
const { SystemServices } = require("../application/system-services.cjs");
const { GitAccountServices } = require("../application/git-account-services.cjs");
const {
  AccountServices,
  initializeAccountServices,
} = require("../application/account-services.cjs");
const {
  accountError,
  DEFAULT_ACCOUNT_SETTINGS,
} = require("../domain/account.cjs");
const { json, body } = require("./messages.cjs");
const { readApiBody, serveApi } = require("./api.cjs");
const { serveStatic } = require("./assets.cjs");
const { createEventStream } = require("./events.cjs");
const {
  validateListenHost,
  httpOrigin,
  requestOrigin,
  publicOrigin,
  isLoopback,
} = require("./origin.cjs");

// Keep existing bounded JSON/image adapters while Fastify owns response hooks.
function responseStream(reply) {
  const stream = new PassThrough();
  let sent = false;
  Object.defineProperty(stream, "headersSent", { get: () => sent });
  stream.setHeader = (name, value) => reply.header(name, value);
  stream.writeHead = (status, headers) => {
    sent = true;
    reply
      .code(status)
      .headers(headers || {})
      .send(stream);
    return stream;
  };
  return stream;
}

function createWebServer({
  host = "127.0.0.1",
  configFile,
  manager,
  channels = manager?.channels,
  workspaces: suppliedWorkspaces,
  workspaceClones: suppliedWorkspaceClones,
  database,
  dataDirectory = database?.dataRoot || dataRoot,
  testIdentity = false,
  publicOrigin: configured = process.env.PUBLIC_ORIGIN,
  staticDirectory = path.join(root, "web", "dist"),
  pageHandler = (request, response, url) =>
    serveStatic(request, response, url, staticDirectory),
} = {}) {
  validateListenHost(host);
  if (testIdentity && !manager && !suppliedWorkspaces)
    throw new Error("测试身份必须配合显式模拟管理器使用。");
  const externalOrigin = publicOrigin(configured);
  const app = Fastify({
    logger: false,
    trustProxy: externalOrigin ? (address) => isLoopback(address) : false,
  });
  const token = randomBytes(32).toString("hex");
  const events = createEventStream();
  const fixtureUser = {
    id: "fixture-user",
    username: "fixture",
    role: "admin",
    status: "active",
    mustChangePassword: false,
  };
  let fixtureSettings = { ...DEFAULT_ACCOUNT_SETTINGS };
  const fixturePreferences = new Map();
  let workspaces = suppliedWorkspaces;
  let workspaceClones = suppliedWorkspaceClones;
  let accounts,
    gitAccounts,
    systemServices,
    closing = false,
    closePromise;
  const ownedDatabase = !testIdentity && !database;

  app.register(async (instance) => {
    if (!testIdentity) {
      accounts = database
        ? new AccountServices(database)
        : await initializeAccountServices(dataDirectory);
      gitAccounts = new GitAccountServices(accounts.database);
      if (!workspaces)
        workspaces = new WorkspaceManager({
          directory: path.join(dataDirectory, "workspaces"),
          database: accounts.database,
        });
      workspaceClones ||= new WorkspaceCloneManager(accounts.database, workspaces);
      await instance.register(cookie);
      await instance.register(session, {
        secret: accounts.sessionSecret(),
        cookieName: "web_coding_session",
        cookie: {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: Boolean(externalOrigin),
          maxAge: 12 * 60 * 60 * 1000,
        },
        saveUninitialized: false,
        rolling: false,
        store: accounts.sessionStore(),
      });
      await instance.register(csrf, {
        sessionPlugin: "@fastify/session",
        getToken: (request) => request.headers["x-tapd-token"],
      });
      await instance.register(rateLimit, { global: false });
    }
    systemServices = new SystemServices(
      workspaces?.directory
        ? path.dirname(workspaces.directory)
        : dataDirectory,
    );
    instance.removeAllContentTypeParsers();
    instance.addContentTypeParser("*", (_request, payload, done) =>
      done(null, payload),
    );
    instance.addHook("onRequest", async (request, reply) => {
      reply
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer")
        .header(
          "content-security-policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
        );
      if (closing) return reply.code(503).send({ error: "服务正在关闭。" });
      const origin = requestOrigin(request.raw, externalOrigin);
      if (!origin)
        return reply
          .code(403)
          .send({ error: "请通过允许的同源服务地址访问。" });
      const url = new URL(request.raw.url, origin);
      if (url.origin !== origin)
        return reply.code(403).send({ error: "请求地址必须与服务地址同源。" });
      // Fastify matches the raw path. Do not let URL normalization dispatch an
      // API route with another route's security hooks (notably login limits).
      if (
        url.pathname.startsWith("/api/") &&
        request.raw.url.split("?", 1)[0] !== url.pathname
      )
        return reply.code(400).send({ error: "接口地址必须使用规范路径。" });
      request.applicationUrl = url;
      if (request.method === "POST") {
        if (testIdentity) {
          if (request.headers["x-tapd-token"] !== token)
            return reply
              .code(403)
              .send({ error: "页面令牌失效，请刷新页面。" });
        } else {
          let allowed = false;
          instance.csrfProtection(request, reply, () => {
            allowed = true;
          });
          if (!allowed) return reply;
        }
      }
    });
    instance.addHook("onResponse", async (request, reply) => {
      if (
        !testIdentity &&
        request.method === "POST" &&
        reply.statusCode < 400 &&
        request.applicationActor
      )
        accounts.audit(
          request.applicationActor,
          `http.${request.raw.url.split("?")[0]}`,
          request.applicationWorkspace,
        );
    });
    const dispatch = async (request, reply) => {
      await handle(request, reply);
      return reply;
    };
    const options = {
      method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
      handler: dispatch,
    };
    instance.route({ ...options, url: "/" });
    instance.route({ ...options, url: "/*" });
    if (!testIdentity)
      instance.route({
        method: "POST",
        url: "/api/auth/login",
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
        handler: dispatch,
      });
    instance.setErrorHandler((error, _request, reply) => {
      reply.code(error.statusCode || 400).send({
        error:
          error.statusCode === 429
            ? "登录尝试过于频繁，请稍后重试。"
            : error.message,
        ...(error.code ? { code: error.code } : {}),
      });
    });
  });

  async function establish(request, row) {
    const previous = request.session.sessionId;
    await request.session.regenerate();
    events.revoke({ sessionId: previous });
    request.session.userId = row.id;
    request.session.authVersion = row.auth_version;
    request.session.absoluteExpiresAt = Date.now() + 12 * 60 * 60 * 1000;
  }

  async function handle(request, reply) {
    const raw = request.raw,
      url = request.applicationUrl;
    if (!url.pathname.startsWith("/api/")) {
      // Vite requires the original Node response and websocket upgrade server.
      for (const [name, value] of Object.entries(reply.getHeaders()))
        reply.raw.setHeader(name, value);
      reply.hijack();
      return pageHandler(raw, reply.raw, url);
    }
    const response = responseStream(reply);
    try {
      let actor = testIdentity ? fixtureUser : accounts.actor(request.session);
      request.applicationActor = actor;
      const csrfToken = () => (testIdentity ? token : reply.generateCsrf());
      const description = () => ({
        user: actor,
        token: csrfToken(),
        ...(actor
          ? {
              settings: testIdentity
                ? fixtureSettings
                : accounts.settings(actor),
            }
          : {}),
      });
      if (request.method === "GET" && url.pathname === "/api/auth/session")
        return json(response, 200, description());
      if (
        request.method === "POST" &&
        url.pathname === "/api/auth/login" &&
        !testIdentity
      ) {
        const row = await accounts.login(await body(raw));
        await establish(request, row);
        actor = accounts.describe(row);
        request.applicationActor = actor;
        return json(response, 200, description());
      }
      if (!actor) throw accountError("请先登录。", 401, "AUTH_REQUIRED");
      const authorize = () => {
        if (testIdentity) return fixtureUser;
        const current = accounts.actor(request.session);
        if (!current) throw accountError("请先登录。", 401, "AUTH_REQUIRED");
        return current;
      };
      // Consume bounded JSON/binary input before resolving any mutable scope.
      // A session can be revoked while the client is still sending its body.
      const input =
        request.method === "POST" ? await readApiBody(raw, url) : {};
      actor = authorize();
      request.applicationActor = actor;
      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        if (!testIdentity) {
          events.revoke({ sessionId: request.session.sessionId });
          await request.session.destroy();
          reply.clearCookie("web_coding_session", { path: "/" });
        }
        return json(response, 200, { ok: true });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/auth/password" &&
        !testIdentity
      ) {
        const row = await accounts.changePassword(actor, input, authorize);
        events.revoke({ userId: actor.id });
        await establish(request, row);
        actor = accounts.describe(row);
        return json(response, 200, description());
      }
      if (actor.mustChangePassword)
        throw accountError(
          "请先修改初始密码。",
          403,
          "PASSWORD_CHANGE_REQUIRED",
        );
      if (url.pathname === "/api/account/settings") {
        if (request.method === "POST") {
          if (testIdentity) fixtureSettings = { ...fixtureSettings, ...input };
          else
            return json(response, 200, {
              settings: accounts.saveSettings(actor, input),
            });
        }
        return json(response, 200, {
          settings: testIdentity ? fixtureSettings : accounts.settings(actor),
        });
      }
      if (request.method === "GET" && url.pathname === "/api/account/models")
        return json(response, 200, {
          models: testIdentity ? [] : await accounts.listModels(),
        });
      if (
        request.method === "GET" &&
        url.pathname === "/api/account/execution-options"
      )
        return json(
          response,
          200,
          testIdentity
            ? { permissionModes: [] }
            : await accounts.executionOptions(),
        );
      if (url.pathname === "/api/account/git-accounts" && !testIdentity) {
        if (request.method === "GET")
          return json(response, 200, { accounts: gitAccounts.list(actor) });
        if (request.method === "POST")
          return json(response, 201, { account: await gitAccounts.save(actor, input, undefined, authorize) });
      }
      if (!testIdentity && request.method === "POST" && url.pathname === "/api/account/git-keys")
        return json(response, 201, await gitAccounts.generateKey(actor, authorize));
      if (!testIdentity && request.method === "POST" && url.pathname === "/api/account/git-accounts/check")
        return json(response, 200, await gitAccounts.check(actor, input));
      const gitAccountRoute = /^\/api\/account\/git-accounts\/([^/]+)(?:\/(test|delete))?$/.exec(url.pathname);
      if (gitAccountRoute && !testIdentity && request.method === "POST") {
        const [, id, action] = gitAccountRoute;
        if (action === "test")
          return json(response, 200, await gitAccounts.check(actor, input, id));
        if (action === "delete") {
          gitAccounts.remove(actor, id);
          return json(response, 200, { ok: true });
        }
        return json(response, 200, { account: await gitAccounts.save(actor, input, id, authorize) });
      }
      if (url.pathname === "/api/account/preferences") {
        const id = input.workspaceId || url.searchParams.get("workspaceId");
        if (!testIdentity || workspaces)
          workspaces.read(id, testIdentity ? undefined : actor);
        if (testIdentity) {
          if (request.method === "POST")
            fixturePreferences.set(id, {
              unreadRunKeys: input.unreadRunKeys || [],
            });
          return json(response, 200, {
            preferences: fixturePreferences.get(id) || { unreadRunKeys: [] },
          });
        }
        return json(response, 200, {
          preferences:
            request.method === "POST"
              ? accounts.savePreferences(actor, id, input)
              : accounts.preferences(actor, id),
        });
      }
      if (url.pathname === "/api/admin/accounts" && !testIdentity) {
        if (request.method === "GET")
          return json(response, 200, { users: accounts.list(actor) });
        if (request.method === "POST")
          return json(response, 201, {
            user: await accounts.create(input, actor, false, authorize),
          });
      }
      const accountRoute = /^\/api\/admin\/accounts\/([^/]+)$/.exec(
        url.pathname,
      );
      if (accountRoute && request.method === "POST" && !testIdentity) {
        const user = await accounts.update(
          accountRoute[1],
          input,
          actor,
          authorize,
        );
        events.revoke({ userId: user.id });
        return json(response, 200, { user });
      }
      const contextActor = testIdentity ? undefined : actor;
      if (
        !manager &&
        request.method === "GET" &&
        url.pathname === "/api/bootstrap"
      )
        return json(response, 200, {
          token: csrfToken(),
          workspaces: workspaces.list(contextActor),
        });
      if (url.pathname === "/api/workspaces") {
        if (request.method === "GET")
          return json(response, 200, {
            workspaces: workspaces.list(contextActor),
          });
        if (request.method === "POST") {
          return json(response, 202, { clone: workspaceClones.start(input, actor) });
        }
      }
      if (url.pathname === "/api/workspace-clones" && request.method === "GET")
        return json(response, 200, { clones: workspaceClones.list(actor) });
      const cloneRoute = /^\/api\/workspace-clones\/([^/]+)(\/dismiss)?$/.exec(url.pathname);
      if (cloneRoute) {
        if (request.method === "GET" && !cloneRoute[2])
          return json(response, 200, { clone: workspaceClones.read(cloneRoute[1], actor) });
        if (request.method === "POST" && cloneRoute[2]) {
          workspaceClones.dismiss(cloneRoute[1], actor);
          return json(response, 200, { ok: true });
        }
      }
      if (url.pathname.startsWith("/api/system/")) {
        if (!testIdentity) accounts.requireAdmin(actor);
        if (url.pathname === "/api/system/settings") {
          if (request.method === "GET")
            return json(response, 200, await systemServices.readSettings());
          if (request.method === "POST")
            return json(response, 200, await systemServices.saveSettings(input));
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/system/directories"
        )
          return json(
            response,
            200,
            await systemServices.listDirectories({
              path: url.searchParams.get("path"),
              offset: url.searchParams.get("offset"),
              limit: url.searchParams.get("limit"),
            }),
          );
      }
      const scoped = /^\/api\/workspaces\/([^/]+)(\/.*)?$/.exec(url.pathname);
      let context;
      if (scoped) {
        const id = scoped[1];
        request.applicationWorkspace = id;
        workspaces.read(id, contextActor);
        if (!scoped[2] && request.method === "POST")
          return json(response, 200, workspaces.save(input, id, contextActor));
        context = workspaces.get(id, contextActor);
        url.pathname = `/api${scoped[2] || "/bootstrap"}`;
      } else if (manager && testIdentity)
        context = { configFile, channels, sessions: manager };
      else throw accountError("请先选择工作区。", 400);
      const sid = request.session?.sessionId;
      const authorization = testIdentity
        ? undefined
        : {
            userId: actor.id,
            sessionId: sid,
            authorize() {
              if (
                !accounts.actor(request.session) ||
                !accounts.sessionValid(sid, actor.id)
              )
                return false;
              try {
                workspaces.read(scoped[1], actor);
                return true;
              } catch {
                return false;
              }
            },
          };
      return await serveApi(raw, response, url, context, {
        token: csrfToken(),
        events,
        authorization,
        accountSettings: testIdentity ? undefined : accounts.settings(actor),
        input,
      });
    } catch (error) {
      if (!response.headersSent)
        json(
          response,
          error.statusCode || (error.code === "ENOENT" ? 404 : 400),
          { error: error.message, ...(error.code ? { code: error.code } : {}) },
        );
      else response.end();
    }
  }

  return {
    server: app.server,
    sessions: manager,
    get workspaces() {
      return workspaces;
    },
    get accounts() {
      return accounts;
    },
    async listen(port = 4317) {
      await app.ready();
      await app.listen({ port, host });
      const bound = app.server.address();
      return httpOrigin(
        bound.address === "0.0.0.0"
          ? "127.0.0.1"
          : bound.address === "::"
            ? "::1"
            : bound.address,
        bound.port,
      );
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      events.close();
      closePromise = Promise.allSettled([
        app.close(),
        Promise.resolve().then(() => manager?.close()),
        Promise.resolve().then(() => workspaces?.close()),
        Promise.resolve().then(() => workspaceClones?.close()),
        Promise.resolve().then(() => accounts?.close()),
      ]).then((results) => {
        if (ownedDatabase) accounts?.closeDatabase();
        const failure = results.find((result) => result.status === "rejected");
        if (failure) throw failure.reason;
      });
      return closePromise;
    },
  };
}
module.exports = { createWebServer };
