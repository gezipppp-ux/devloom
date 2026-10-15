const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { gitHost } = require("../domain/git-account.cjs");
const { withSshPrivateKey } = require("./ssh-key-files.cjs");

function runSsh(args, options) {
  return new Promise(resolve => {
    const child = execFile("ssh", args, options, (error, stdout, stderr) => resolve({ error, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end();
  });
}

async function verifySsh(account, execute) {
  const url = new URL(`ssh://${gitHost(account.host, "ssh")}`);
  return withSshPrivateKey(account.sshPrivateKey, async (key, configFile) => {
    const logFile = path.join(path.dirname(key), "authentication.log");
    const { error } = await execute([
      "-v", "-E", logFile, "-T", "-F", configFile, "-i", key,
      "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
      "-o", "BatchMode=yes", "-o", "PreferredAuthentications=publickey",
      "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15",
      "-p", url.port || "22", "-l", "git", "--", url.hostname.replace(/^\[|\]$/g, ""),
    ], { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
      env: { ...process.env, LC_ALL: "C", LANG: "C" } });
    // Git hosts commonly exit with 1 after successful authentication because
    // they do not offer an interactive shell. -E separates OpenSSH events from
    // server-controlled banners and shell output; never trust stdout/stderr.
    if (error?.killed) throw new Error("Git 主机登录验证超时，请检查网络后重试。");
    const log = fs.existsSync(logFile) && fs.statSync(logFile).size <= 1024 * 1024 ? fs.readFileSync(logFile, "utf8") : "";
    if (!/^(?:Authenticated to .+ using "publickey"\.|debug1: Authentication succeeded \(publickey\)\.)\r?$/m.test(log))
      throw new Error("SSH 登录验证失败，请检查主机、端口和公钥授权，并确认服务器已安装 OpenSSH。");
  });
}

async function verifyHttp(account, provider, request) {
  const host = gitHost(account.host, "http");
  const signal = AbortSignal.timeout(30000);
  if (provider === "auto") {
    provider = { "https://github.com": "github", "https://gitee.com": "gitee", "https://gitlab.com": "gitlab" }[host]
      || await detectGitea(host, request, signal);
  }
  if (!provider) throw new Error("此主机无法自动识别登录接口，请选择 Git 服务；其他服务请通过项目开发空间验证仓库访问权限。");
  if (!["github", "gitee", "gitlab", "gitea"].includes(provider)) throw new Error("Git 登录验证服务类型无效。");
  const endpoint = provider === "github"
    ? (host === "https://github.com" ? "https://api.github.com/user" : `${host}/api/v3/user`)
    : `${host}${{ gitee: "/api/v5/user", gitlab: "/api/v4/user", gitea: "/api/v1/user" }[provider]}`;
  const headers = { Accept: "application/json", "User-Agent": "Web-Coding" };
  if (provider === "gitlab") headers["PRIVATE-TOKEN"] = account.password;
  else if (provider === "gitea") headers.Authorization = `token ${account.password}`;
  else headers.Authorization = `Bearer ${account.password}`;
  let response, user;
  try {
    response = await request(endpoint, { headers, redirect: "manual", signal });
  } catch {
    // Never expose response bodies, headers, tokens or transport diagnostics.
    throw new Error("Git 主机登录验证失败或超时，请检查网络和服务类型后重试。");
  }
  if (response.status === 401 || response.status === 403)
    throw new Error("Git 登录验证失败，请使用可读取本人资料的个人访问令牌；此验证接口不支持普通账号密码。");
  if (response.status === 404)
    throw new Error("Git 登录接口不存在（404），请检查服务类型和主机地址。Gitea 与 GitLab 是不同的服务，请选择对应类型或使用自动识别。");
  if (response.status >= 300 && response.status < 400)
    throw new Error("Git 登录接口发生重定向，请填写最终主机地址后重试；验证不会携带凭据跟随跳转。");
  if (!response.ok) throw new Error("Git 主机登录接口不可用，请检查服务类型、主机地址和网络后重试。");
  try { user = await response.json(); }
  catch { throw new Error("Git 主机未返回有效的登录身份，请检查服务类型后重试。"); }
  const login = provider === "gitlab" ? user?.username : user?.login;
  if (!user?.id || typeof login !== "string" || login.toLowerCase() !== account.username.toLowerCase())
    throw new Error("登录验证返回的账号与填写的用户名不一致，或主机未返回有效的登录身份。请填写 Git 服务的登录用户名。");
}

async function detectGitea(host, request, signal) {
  try {
    // Probe only the user-supplied origin, without credentials or redirects.
    // Do not infer a service from its port or from links in the response.
    const response = await request(`${host}/`, {
      headers: { Accept: "text/html", "User-Agent": "Web-Coding" }, redirect: "manual", signal,
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
      await response.body?.cancel();
      return null;
    }
    let html = "", size = 0;
    const decoder = new TextDecoder();
    // Bound the public probe even when a host returns an oversized page.
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 128 * 1024) return null;
      html += decoder.decode(chunk, { stream: true });
      if (/<\/head\s*>/i.test(html)) break;
    }
    for (const tag of html.match(/<meta\s[^>]*>/gi) || []) {
      if (/\bname\s*=\s*["'](?:author|generator)["']/i.test(tag)
        && /\bcontent\s*=\s*["']Gitea(?:\s[^"']*)?["']/i.test(tag)) return "gitea";
    }
    return null;
  } catch {
    throw new Error("Git 主机自动识别失败或超时，请检查部署服务器的网络和主机地址，或手动选择 Git 服务后重试。");
  }
}

async function verifyGitHostLogin(account, provider = "auto", { request = fetch, execute = runSsh } = {}) {
  if (account.authType === "ssh") await verifySsh(account, execute);
  else await verifyHttp(account, provider, request);
}

module.exports = { verifyGitHostLogin };
