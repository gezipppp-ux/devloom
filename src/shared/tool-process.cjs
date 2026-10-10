const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { stopProcessTree } = require("./process-tree.cjs");

function runTool(command, args, { timeout = 15000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", bytes = 0, failure, stopping;
    const stop = message => { failure ||= new Error(message); stopping ||= stopProcessTree(child); };
    const timer = setTimeout(() => stop("命令超时，请检查环境及安装状态后重试。"), timeout);
    for (const [stream, keep] of [[child.stdout, true], [child.stderr, false]]) {
      stream.setEncoding("utf8");
      stream.on("data", chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 1024 * 1024) stop("安装器输出超出限制，请检查安装状态。");
        else if (keep) stdout += chunk;
      });
    }
    child.once("error", () => { failure ||= new Error("无法启动命令，请检查安装和服务账号权限。"); });
    child.once("close", async code => {
      clearTimeout(timer);
      await stopping;
      if (failure || code !== 0) reject(failure || new Error(`命令执行失败（退出码 ${code}），请检查安装、权限和网络。`));
      else resolve(stdout.trim());
    });
  });
}

function findExecutable(name) {
  const key = Object.keys(process.env).find(key => key.toUpperCase() === "PATH");
  for (const directory of (process.env[key] || "").split(path.delimiter)) {
    const absolute = directory.replace(/^"(.*)"$/, "$1");
    if (!path.isAbsolute(absolute)) continue;
    const file = path.join(absolute, name);
    try {
      // Windows App Execution Aliases cannot be dereferenced with stat/realpath,
      // but CreateProcess can launch their registered application.
      if (process.platform === "win32" && name === "winget.exe" &&
          path.resolve(absolute).toLowerCase() === path.resolve(process.env.LOCALAPPDATA || "", "Microsoft/WindowsApps").toLowerCase() &&
          fs.lstatSync(file).isSymbolicLink()) return file;
      if (fs.statSync(file).isFile()) {
        fs.accessSync(file, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
        return fs.realpathSync(file);
      }
    } catch { /* Continue through PATH. */ }
  }
  return null;
}

function npmCommand() {
  const file = findExecutable(process.platform === "win32" ? "npm.cmd" : "npm");
  // nvm 2 uses native proxy executables instead of npm.cmd on PATH.
  const script = file ? (process.platform === "win32" ? path.join(path.dirname(file), "node_modules/npm/bin/npm-cli.js") : file)
    : path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  if (path.basename(script) !== "npm-cli.js" || !fs.existsSync(script))
    throw new Error("未识别 npm 安装方式，请使用原安装工具管理。");
  return { command: process.execPath, args: [script], script: fs.realpathSync(script) };
}

function sameFile(left, right) {
  try {
    const a = fs.realpathSync(left), b = fs.realpathSync(right);
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
  catch { return false; }
}

module.exports = { runTool, findExecutable, npmCommand, sameFile };
