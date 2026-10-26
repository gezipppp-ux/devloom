const { spawn } = require("node:child_process");
const { stopProcessTree } = require("../shared/process-tree.cjs");
const { gitFailureMessage } = require("./git-failure.cjs");

// A progressing pack transfer can legitimately take longer than one minute.
// Bound both silence and total duration, and retain the repository lock until
// every Git transport/indexer process has stopped.
function runFetch(args, env, { signal, timeout = 30 * 60 * 1000, idleTimeout = 2 * 60 * 1000 } = {}) {
  if (signal?.aborted) return Promise.reject(new Error("任务准备已停止。"));
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      env: { ...env, LC_ALL: "C", LANG: "C" }, windowsHide: true,
      detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"],
    });
    let failure, stopping, idle, diagnostics = "";
    const stop = message => {
      failure ||= new Error(message);
      stopping ||= stopProcessTree(child);
    };
    const abort = () => stop("任务准备已停止。");
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => stop("获取开发基准分支超时：Git 长时间没有响应，请检查服务器网络后重试。"), idleTimeout);
    };
    const timer = setTimeout(() => stop("获取开发基准分支超过最长等待时间，请检查仓库大小和网络后重试。"), timeout);
    child.stderr.setEncoding("utf8").on("data", chunk => {
      diagnostics = (diagnostics + chunk).slice(-65536);
      touch();
    });
    child.once("error", error => { failure ||= new Error(gitFailureMessage(error)); });
    child.once("close", async code => {
      clearTimeout(timer); clearTimeout(idle);
      signal?.removeEventListener("abort", abort);
      await stopping;
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(/couldn.t find remote ref/i.test(diagnostics)
        ? "获取开发基准分支失败：所选远端分支已不存在，请核对分支。"
        : "获取开发基准分支失败：" + gitFailureMessage({ code }, diagnostics)));
      else resolve();
    });
    signal?.addEventListener("abort", abort, { once: true });
    touch();
    if (signal?.aborted) abort();
  });
}

module.exports = { runFetch };
