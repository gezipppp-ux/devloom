const fs = require("node:fs");
const path = require("node:path");
const { json } = require("./messages.cjs");
const { pageStatus } = require("./page-routes.cjs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

function sendFile(response, file, cacheControl, statusCode = 200) {
  response.writeHead(statusCode, {
    "content-type":
      MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
    "cache-control": cacheControl,
  });
  fs.createReadStream(file)
    .on("error", () => response.destroy())
    .pipe(response);
}

function serveStatic(request, response, url, staticDirectory) {
  if (request.method !== "GET")
    return json(response, 405, { error: "不支持该请求方法" });
  const statusCode = pageStatus(request, url);
  const relative =
    statusCode
      ? "index.html"
      : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(staticDirectory, relative);
  if (!isInside(staticDirectory, file))
    return json(response, 403, { error: "无效的文件路径" });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile())
    return json(response, 404, {
      error: "页面未构建，请运行 npm run build。",
    });
  if (
    !isInside(
      fs.realpathSync.native(staticDirectory),
      fs.realpathSync.native(file),
    )
  )
    return json(response, 403, { error: "无效的文件路径" });
  sendFile(response, file, "no-cache", statusCode || 200);
}

function isInside(directory, file) {
  const relative = path.relative(directory, file);
  return (
    relative &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

module.exports = { sendFile, serveStatic };
