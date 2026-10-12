const { execFile } = require("node:child_process");
const { git } = require("./command.cjs");
const { resolveCommit } = require("./repository.cjs");
const { withGitAccount } = require("./account-credentials.cjs");
const { validateBaseBranch } = require("../domain/development-baseline.cjs");

function fetchCommand(args, env, signal) {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, {
      env, signal, windowsHide: true, timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
    }, (error) => {
      if (error) reject(new Error(signal?.aborted
        ? "任务准备已停止。"
        : "获取开发基准分支失败，请检查远端分支、网络和 Git 账号后重试。"));
      else resolve();
    });
    child.stdin.on("error", () => {});
    child.stdin.end();
  });
}

async function fetchDevelopmentBaseline(repository, value, { credentials, signal, authorize = async () => {} } = {}) {
  const branch = validateBaseBranch(value);
  const check = async () => {
    if (signal?.aborted) throw new Error("任务准备已停止。");
    await authorize();
    if (signal?.aborted) throw new Error("任务准备已停止。");
  };
  await check();
  const remote = "origin";
  let address;
  try { address = git(repository, ["remote", "get-url", "--all", remote]); }
  catch { throw new Error("开发仓库未配置 origin 远端。"); }
  if (credentials && address !== credentials.remoteUrl)
    throw new Error("远端地址已变更，不能使用此工作区保存的 Git 账号。");
  const ref = `refs/remotes/origin/${branch}`;
  const args = ["-C", repository, "fetch", "--no-tags", "--no-recurse-submodules", "--", remote, `+refs/heads/${branch}:${ref}`];
  if (credentials) {
    await withGitAccount(credentials.account, credentials.remoteUrl,
      (run) => {
        // SSH key setup is asynchronous; recheck immediately before dispatch.
        if (git(repository, ["remote", "get-url", "--all", remote]) !== credentials.remoteUrl)
          throw new Error("远端地址已变更，不能使用此工作区保存的 Git 账号。");
        return run(args);
      }, (command, env) => fetchCommand(command, env, signal));
  } else {
    await fetchCommand(args, { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" }, signal);
  }
  await check();
  if (git(repository, ["remote", "get-url", "--all", remote]) !== address)
    throw new Error("获取期间远端地址已变更，请重新检查仓库配置。");
  return { remote, branch, commit: resolveCommit(repository, ref), fetchedAt: new Date().toISOString() };
}

module.exports = { fetchDevelopmentBaseline };
