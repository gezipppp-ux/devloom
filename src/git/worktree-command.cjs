const { spawn } = require("node:child_process");
const { stopProcessTree } = require("../shared/process-tree.cjs");

// Checkout can run filters and hooks. Keep the caller's repository lock until
// Git and its pipes have closed, including when stopping its process tree.
function runWorktreeGit(repository, args, { signal, timeout = 60000, stdout = "ignore" } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("任务准备已停止。"));
      return;
    }
    const child = spawn("git", ["-c", "credential.interactive=false", "-C", repository, ...args], {
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", stdout, "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
    });
    let failure;
    let stopping;
    let diagnostics = "";
    const stop = (error) => {
      if (stopping) return;
      failure ||= error;
      stopping = stopProcessTree(child);
    };
    const abort = () => stop(new Error("任务准备已停止。"));
    const timer = setTimeout(() => stop(new Error(`Worktree Git 操作超时（${Math.round(timeout / 1000)} 秒）。`)), timeout);
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      // Drain arbitrary checkout progress without accumulating an entire log.
      diagnostics = (diagnostics + chunk).slice(-65536);
    });
    child.once("error", (error) => { failure ||= error; });
    child.once("close", async (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      await stopping;
      if (failure) reject(failure);
      else if (code !== 0) reject(Object.assign(
        new Error(`Worktree Git 操作失败（${exitSignal || code}）。${diagnostics.trim()}`),
        { code, signal: exitSignal },
      ));
      else resolve();
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

module.exports = { runWorktreeGit };
