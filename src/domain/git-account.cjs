const { accountError } = require("./account.cjs");

function requiredText(value, label, maximum = 2000) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw accountError(`${label}无效。`);
  return value.trim();
}
function gitAccountId(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)
  )
    throw accountError("Git 账号或密钥标识无效。");
  return value;
}
function remoteUrl(value) {
  const remote = requiredText(value, "Git 远程地址");
  if (/\s|\\/.test(remote))
    throw accountError("Git 远程地址不能包含空白或反斜线。");
  if (
    /^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+:[^/].+/.test(remote) &&
    !remote.includes("://")
  )
    return remote;
  let url;
  try {
    url = new URL(remote);
  } catch {
    throw accountError("请输入完整的 Git 远程仓库地址。");
  }
  if (
    !["http:", "https:", "ssh:"].includes(url.protocol) ||
    !url.hostname ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "ssh:" && url.username) ||
    !url.pathname.replaceAll("/", "")
  )
    throw accountError(
      "请输入 SSH 或 HTTP/HTTPS 仓库地址，凭据须填写在账号字段中。",
    );
  return remote;
}
function remoteAuthType(remote) {
  return /^https?:\/\//i.test(remoteUrl(remote)) ? "http" : "ssh";
}
function gitHost(value, authType) {
  const host = requiredText(value, "Git 主机", 300);
  try {
    const url = new URL(authType === "http" ? host : `ssh://${host}`);
    if (!(authType === "http" ? ["http:", "https:"].includes(url.protocol) : url.protocol === "ssh:") || url.username || url.password || url.search || url.hash || !url.hostname || !["", "/"].includes(url.pathname)) throw new Error("invalid");
    return authType === "http" ? url.origin.toLowerCase() : `${url.hostname.toLowerCase()}${url.port && url.port !== "22" ? `:${url.port}` : ""}`;
  } catch { throw accountError("Git 主机无效；HTTP 请填写协议及主机，SSH 请填写主机和可选端口，不包含仓库路径或凭据。"); }
}
function remoteHost(remote) {
  remote = remoteUrl(remote);
  if (!remote.includes("://")) return gitHost(remote.slice(remote.indexOf("@") + 1, remote.indexOf(":")), "ssh");
  const url = new URL(remote);
  return remoteAuthType(remote) === "http" ? url.origin.toLowerCase() : gitHost(`${url.hostname}${url.port ? `:${url.port}` : ""}`, "ssh");
}
function projectName(remote) {
  const name = remoteUrl(remote)
    .replace(/\/$/, "")
    .split(/[/:]/)
    .at(-1)
    .replace(/\.git$/i, "");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(name) ||
    /[. ]$/.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw accountError(
      "无法从 Git 地址生成项目目录名，请使用以项目名结尾的地址。",
    );
  return name;
}
function validateGitAccount(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "name",
          "authType",
          "host",
          "authorName",
          "authorEmail",
          "revision",
          "username",
          "password",
          "keyDraftId",
        ].includes(key),
    )
  )
    throw accountError("Git 账号包含未知字段。");
  const name = requiredText(input.name, "Git 账号名称", 80);
  if (!["ssh", "http"].includes(input.authType)) throw accountError("认证方式无效。");
  const value = { name, authType: input.authType, host: gitHost(input.host, input.authType), remoteUrl: "" };
  value.authorName = input.authorName === undefined || input.authorName === "" ? "" : requiredText(input.authorName, "提交作者姓名", 200);
  value.authorEmail = input.authorEmail === undefined || input.authorEmail === "" ? "" : requiredText(input.authorEmail, "提交作者邮箱", 254);
  if (Boolean(value.authorName) !== Boolean(value.authorEmail) || value.authorName.includes("<") || value.authorName.includes(">") || (value.authorEmail && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.authorEmail))) throw accountError("提交作者姓名与有效邮箱需同时填写，与 Git 登录凭据分别管理。");
  if (input.revision !== undefined) {
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw accountError("Git 账号修订号无效。", 409);
    value.revision = input.revision;
  }
  if (input.authType === "http") {
    if (input.keyDraftId !== undefined)
      throw accountError("HTTP 账号不接受 SSH 密钥。");
    value.username = requiredText(input.username, "Git 用户名", 256);
    if (value.username.includes(":"))
      throw accountError("Git 用户名不能包含冒号。");
    if (input.password !== undefined) {
      if (
        typeof input.password !== "string" ||
        !input.password ||
        input.password.length > 20000 ||
        /[\x00-\x1f\x7f]/.test(input.password)
      )
        throw accountError("密码或访问令牌无效。");
      value.password = input.password;
    }
  } else {
    if (input.username !== undefined || input.password !== undefined)
      throw accountError("SSH 账号不接受 HTTP 凭据。");
    if (input.keyDraftId !== undefined)
      value.keyDraftId = gitAccountId(input.keyDraftId);
  }
  return value;
}
module.exports = {
  validateGitAccount,
  gitAccountId,
  remoteUrl,
  remoteAuthType,
  remoteHost,
  gitHost,
  projectName,
};
