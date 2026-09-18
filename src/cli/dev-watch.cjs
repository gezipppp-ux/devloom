const fs = require("node:fs");
const path = require("node:path");
const { fork } = require("node:child_process");
const { root } = require("../config/runtime.cjs");

async function main(
  argv = process.argv.slice(2),
  {
    directory = root,
    entry = path.join(root, "src", "cli", "dev.cjs"),
    debounceMs = 200,
    shutdownTimeoutMs = 15000,
  } = {},
) {
  const watchers = [];
  let current;
  let timer;
  let closing = false;
  let restarting = false;
  let restartRequested = false;
  let closePromise;

  function report(error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }

  function stopWatching() {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    watchers.length = 0;
  }

  function startChild() {
    const child = fork(entry, argv, {
      windowsHide: true,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    const record = { child, ready: false, ended: false, stopping: false };
    current = record;
    record.exit = new Promise((resolve) => child.once("close", resolve));
    return new Promise((resolve, reject) => {
      child.on("message", (message) => {
        if (message?.type !== "dev:ready" || record.ready) return;
        record.ready = true;
        if (!closing && !record.stopping) {
          process.exitCode = 0;
          if (process.connected) process.send(message, () => {});
        }
        resolve();
      });
      child.once("error", reject);
      child.once("close", (code, signal) => {
        record.ended = true;
        if (!record.ready)
          reject(
            new Error(`开发服务启动失败（${signal || `退出码 ${code}`}）。`),
          );
        else if (!record.stopping && !closing)
          report(
            new Error(
              `开发服务已退出（${signal || `退出码 ${code}`}），修正代码并保存后重试。`,
            ),
          );
      });
    });
  }

  function stopChild() {
    const record = current;
    if (!record || record.ended) return Promise.resolve();
    if (record.stopPromise) return record.stopPromise;
    record.stopping = true;
    record.stopPromise = (async () => {
      // Windows child.kill("SIGTERM") bypasses the child's signal handlers.
      // Keep its IPC channel alive until application and Codex cleanup finish.
      if (record.child.connected)
        record.child.send({ type: "dev:shutdown" }, (error) => {
          if (error && !record.ended) report(error);
        });
      const timeout = setTimeout(() => {
        closing = true;
        stopWatching();
        report(
          new Error(
            "开发服务关闭超时，已停止监视，等待原进程清理；不会启动替代进程。",
          ),
        );
      }, shutdownTimeoutMs);
      await record.exit;
      clearTimeout(timeout);
    })();
    return record.stopPromise;
  }

  function close() {
    if (!closePromise) {
      closing = true;
      stopWatching();
      closePromise = stopChild().finally(() => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        process.off("message", onMessage);
        process.off("disconnect", onSignal);
        if (process.connected) process.disconnect();
      });
    }
    return closePromise;
  }

  function onSignal() {
    void close().catch(report);
  }

  function onMessage(message) {
    if (message?.type === "dev:shutdown") onSignal();
  }

  async function restart() {
    if (closing || restarting) return;
    restarting = true;
    try {
      do {
        restartRequested = false;
        process.stdout.write("后端代码已修改，正在关闭并重新启动开发服务……\n");
        await stopChild();
        if (closing) break;
        try {
          await startChild();
        } catch (error) {
          if (!closing) {
            report(error);
            process.stderr.write("等待修正代码并保存后重试。\n");
          }
        }
      } while (restartRequested && !closing);
    } finally {
      restarting = false;
      if (closing) await close();
    }
  }

  function changed(_event, filename) {
    if (closing || !filename || !/\.(?:cjs|json)$/i.test(String(filename)))
      return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      restartRequested = true;
      void restart().catch(report);
    }, debounceMs);
  }

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("message", onMessage);
  process.on("disconnect", onSignal);
  try {
    for (const name of ["src", "shared"]) {
      const watcher = fs.watch(
        path.join(directory, name),
        { recursive: true },
        changed,
      );
      watcher.on("error", (error) => {
        report(error);
        void close().catch(report);
      });
      watchers.push(watcher);
    }
    restarting = true;
    await startChild();
    restarting = false;
    if (restartRequested) void restart().catch(report);
    return { close };
  } catch (error) {
    restarting = false;
    const interrupted = closing;
    await close();
    if (!interrupted) throw error;
    return { close };
  }
}

if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });

module.exports = { main };
