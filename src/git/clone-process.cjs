const { spawn } = require("node:child_process");
const { stopProcessTree } = require("../shared/process-tree.cjs");
const { cloneProgressParser } = require("./clone-progress.cjs");

function runClone(args, env, { signal, onProgress = () => {} } = {}) {
  if (signal?.aborted) return Promise.reject(new Error("克隆已中断。"));
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      env: { ...env, LC_ALL: "C", LANG: "C" }, windowsHide: true,
      detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"],
    });
    let failure, stopping, idle;
    let progressWrites = Promise.resolve();
    const stop = message => {
      failure ||= new Error(message);
      stopping ||= stopProcessTree(child);
    };
    const abort = () => stop("克隆已中断。");
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => stop("Git 超过 30 分钟没有响应，请检查网络后重试。"), 30 * 60 * 1000);
    };
    const timeout = setTimeout(() => stop("克隆超过 6 小时，请检查仓库大小和网络后重试。"), 6 * 60 * 60 * 1000);
    const progress = cloneProgressParser(value => {
      const snapshot = structuredClone(value);
      progressWrites = progressWrites.then(() => onProgress(snapshot))
        .catch(() => stop("无法记录克隆进度，克隆已停止，请检查服务存储。"));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      touch();
      try { progress(chunk); }
      catch { stop("无法记录克隆进度，克隆已停止，请检查服务存储。"); }
    });
    child.once("error", () => { failure ||= new Error("无法启动 Git，请检查服务器 Git 环境。"); });
    child.once("close", async code => {
      clearTimeout(timeout); clearTimeout(idle);
      signal?.removeEventListener("abort", abort);
      await progressWrites;
      await stopping;
      if (failure || code !== 0) reject(failure || new Error("Git 克隆失败，请检查网络、远程地址、凭据与磁盘空间后重试。"));
      else resolve("");
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    touch();
  });
}
module.exports = { runClone };
