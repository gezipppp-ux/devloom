const fs = require("node:fs");
const path = require("node:path");
const { json } = require("./messages.cjs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

function sendFile(response, file, cacheControl) {
  response.writeHead(200, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
    "cache-control": cacheControl,
  });
  fs.createReadStream(file)
    .on("error", () => response.destroy())
    .pipe(response);
}

function serveStatic(request, response, url, staticDirectory) {
  if (request.method !== "GET")
    return json(response, 405, { error: "不支持该请求方法" });
  const relative =
    url.pathname === "/"
      ? "index.html"
      : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(staticDirectory, relative);
  if (!file.startsWith(path.resolve(staticDirectory) + path.sep))
    return json(response, 403, { error: "无效的文件路径" });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile())
    return json(response, 404, {
      error: "页面未构建，请运行 npm run web:build。",
    });
  sendFile(response, file, "no-cache");
}

module.exports = { sendFile, serveStatic };
