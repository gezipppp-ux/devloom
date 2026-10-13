const path = require("node:path");
const { argument } = require("./arguments.cjs");
const { root } = require("../config/runtime.cjs");
const { createWebServer } = require("../http/server.cjs");
const { requestOrigin } = require("../http/origin.cjs");
const { printSetupLink } = require("./setup-link.cjs");

async function main(argv = process.argv.slice(2)) {
  if (argument("--config", null, argv))
    throw new Error("开发服务使用工作区配置，不支持 --config。");
  const port = Number(argument("--port", "5173", argv));
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("端口需为 0–65535（0 表示自动分配）。");
  const host = argument("--host", "127.0.0.1", argv);
  let vite;
  let closePromise;
  const application = createWebServer({
    host,
    pageHandler(request, response, url) {
      if (["/setup", "/login", "/password", "/personal", "/system", "/accounts", "/environment"].includes(url.pathname))
        request.url = `/index.html${url.search}`;
      // Only development pages need Vite's HMR socket and reconnect worker.
      // The HTTP adapter has already validated this request's host and origin.
      const socketOrigin = url.origin.replace(/^http:/, "ws:");
      response.setHeader(
        "content-security-policy",
        `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${socketOrigin}; worker-src 'self' blob:; frame-ancestors 'none'`,
      );
      vite.middlewares(request, response);
    },
  });
  // Upgrade requests bypass the HTTP request handler. Keep the same checks
  // in front of Vite's own WebSocket token validation.
  const validateUpgrade = (request, socket) => {
    if (!requestOrigin(request)) socket.destroy();
  };
  application.server.on("upgrade", validateUpgrade);

  function close() {
    if (closePromise) return closePromise;
    closePromise = Promise.allSettled([
      application.close(),
      vite?.close(),
    ]).then((results) => {
      application.server.off("upgrade", validateUpgrade);
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
    });
    return closePromise;
  }

  try {
    const { createServer } = await import("vite");
    vite = await createServer({
      configFile: path.join(root, "web", "vite.config.mjs"),
      // Only the explicit application routes above use the SPA entry.
      // Unknown files must not fall back to (and pretransform) index.html.
      appType: "mpa",
      // This .mjs config can be loaded directly without temporary build files.
      configLoader: "native",
      server: {
        host,
        middlewareMode: true,
        // Vite 8 speculative transforms can wait on a cancelled optimizer at
        // shutdown. Transform on demand to avoid those stalled requests.
        preTransformRequests: false,
        hmr: { server: application.server },
        fs: {
          // The repository root also contains private workspace data.
          allow: ["web", "shared", "node_modules"].map((name) =>
            path.join(root, name),
          ),
        },
      },
    });
    const origin = await application.listen(port);
    await printSetupLink(application, process.env.PUBLIC_ORIGIN || origin);
    process.stdout.write(
      `Web Coding Dev: ${origin}\n监听地址：${host}:${application.server.address().port}\n前端保存后自动更新。使用 dev:watch 时，后端修改会重启服务、中断活动任务并刷新页面。\n`,
    );
    return { origin, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (require.main === module) {
  let stopping = false;
  const started = main();
  const report = (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  };
  const disconnect = () => {
    if (process.connected) process.disconnect();
  };
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    // A stop arriving during Vite startup must also wait for and close it.
    started
      .then(
        (service) => service.close(),
        () => {},
      )
      .catch(report)
      .finally(disconnect);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  if (process.send) {
    process.on("message", (message) => {
      if (message?.type === "dev:shutdown") shutdown();
    });
    process.once("disconnect", shutdown);
  }
  started.then(
    ({ origin }) => {
      if (!stopping && process.connected)
        process.send({ type: "dev:ready", origin }, () => {});
    },
    (error) => {
      report(error);
      disconnect();
    },
  );
}

module.exports = { main };
