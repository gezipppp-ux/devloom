const { argument } = require("./arguments.cjs");
const { createWebServer } = require("../http/server.cjs");

async function main(argv = process.argv.slice(2)) {
  if (argument("--config", null, argv))
    throw new Error(
      "Web 配置已按工作区管理，请在页面创建并配置工作区；--config 仅用于 CLI 命令。",
    );
  const port = Number(argument("--port", null, argv) || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("端口需为 1–65535。");
  const application = createWebServer();
  const origin = await application.listen(port);
  process.stdout.write(
    `TAPD Web CLI: ${origin}\n保持此进程运行；关闭浏览器不会停止 Codex。\n`,
  );
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    application.close().catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
module.exports = { main };
