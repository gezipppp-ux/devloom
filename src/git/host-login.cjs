const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
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
  if (provider === "auto") {
    provider = { "https://github.com": "github", "https://gitee.com": "gitee", "https://gitlab.com": "gitlab" }[host];
  }
  if (!provider) throw new Error("此主机无法自动识别登录接口，请选择 Git 服务；其他服务请通过项目开发空间验证仓库访问权限。");
  const endpoint = provider === "github"
    ? (host === "https://github.com" ? "https://api.github.com/user" : `${host}/api/v3/user`)
    : `${host}${provider === "gitee" ? "/api/v5/user" : "/api/v4/user"}`;
  const headers = { Accept: "application/json", "User-Agent": "Web-Coding" };
  if (provider === "gitlab") headers["PRIVATE-TOKEN"] = account.password;
  else headers.Authorization = `Bearer ${account.password}`;
  let response, user;
  try {
    response = await request(endpoint, { headers, redirect: "manual", signal: AbortSignal.timeout(30000) });
  } catch {
    // Never expose response bodies, headers, tokens or transport diagnostics.
    throw new Error("Git 主机登录验证失败或超时，请检查网络和服务类型后重试。");
  }
  if (response.status === 401 || response.status === 403)
    throw new Error("Git 登录验证失败，请使用可读取本人资料的个人访问令牌；此验证接口不支持普通账号密码。");
  if (!response.ok) throw new Error("Git 主机登录接口不可用，请检查服务类型、主机地址和网络后重试。");
  try { user = await response.json(); }
  catch { throw new Error("Git 主机未返回有效的登录身份，请检查服务类型后重试。"); }
  const login = provider === "gitlab" ? user?.username : user?.login;
  if (!user?.id || typeof login !== "string" || login.toLowerCase() !== account.username.toLowerCase())
    throw new Error("登录验证返回的账号与填写的用户名不一致，或主机未返回有效的登录身份。请填写 Git 服务的登录用户名。");
}

async function verifyGitHostLogin(account, provider = "auto", { request = fetch, execute = runSsh } = {}) {
  if (account.authType === "ssh") await verifySsh(account, execute);
  else await verifyHttp(account, provider, request);
}

module.exports = { verifyGitHostLogin };
