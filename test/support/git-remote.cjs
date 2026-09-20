const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { execFile, execFileSync } = require("node:child_process");

// Loopback-only smart HTTP Git server; no live credentials or Git provider involved.
async function gitRemote(directory, { username = "fixture", password = 'pa&ss|%word!"', empty = false } = {}) {
  const repository = path.join(directory, "remote.git");
  fs.mkdirSync(repository, { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  if (!empty) {
    fs.writeFileSync(path.join(repository, "README.md"), "fixture repository");
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
  }
  const requests = [];
  const authorization = "Basic " + Buffer.from(username + ":" + password).toString("base64");
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    if (request.headers.authorization !== authorization) {
      response.writeHead(401, { "www-authenticate": 'Basic realm="Git fixture"' }); response.end(); return;
    }
    const url = new URL(request.url, "http://localhost");
    const child = execFile("git", ["http-backend"], { encoding: "buffer", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_PROJECT_ROOT: directory, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1), REQUEST_METHOD: request.method, CONTENT_TYPE: request.headers["content-type"] || "",
        CONTENT_LENGTH: request.headers["content-length"] || "", REMOTE_USER: username, REMOTE_ADDR: "127.0.0.1" },
    }, (error, output) => {
      if (error) { response.writeHead(500); response.end("fixture Git backend failed"); return; }
      const split = output.indexOf("\r\n\r\n");
      const headers = {}, lines = output.subarray(0, split).toString().split("\r\n");
      let status = 200;
      for (const line of lines) {
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const key = line.slice(0, colon), value = line.slice(colon + 1).trim();
        if (key.toLowerCase() === "status") status = Number(value.split(" ")[0]); else headers[key] = value;
      }
      response.writeHead(status, headers); response.end(output.subarray(split + 4));
    });
    child.stdin.on("error", () => {});
    request.pipe(child.stdin);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { repository, git, requests, username, password, remoteUrl: `http://127.0.0.1:${server.address().port}/remote.git`,
    close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { gitRemote };
