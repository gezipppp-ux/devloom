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
      if (failure || code !== 0) reject(failure || Object.assign(new Error(`命令执行失败（退出码 ${code}），请检查安装、权限和网络。`), { exitCode: code }));
      else resolve(stdout.trim());
    });
  });
}

function findExecutable(name, { platform = process.platform, env = process.env, fs: io = fs, fallbackDirectories = [] } = {}) {
  const windows = platform === "win32";
  const paths = windows ? path.win32 : path.posix;
  const key = Object.keys(env).find(key => windows ? key.toUpperCase() === "PATH" : key === "PATH");
  for (const directory of [...(env[key] || "").split(paths.delimiter), ...fallbackDirectories]) {
    const absolute = windows ? directory.replace(/^"(.*)"$/, "$1") : directory;
    if (!paths.isAbsolute(absolute)) continue;
    const file = paths.join(absolute, name);
    try {
      // Windows App Execution Aliases cannot be dereferenced with stat/realpath,
      // but CreateProcess can launch their registered application.
      if (windows && name === "winget.exe" &&
          paths.resolve(absolute).toLowerCase() === paths.resolve(env.LOCALAPPDATA || "", "Microsoft/WindowsApps").toLowerCase() &&
          io.lstatSync(file).isSymbolicLink()) return file;
      if (io.statSync(file).isFile()) {
        io.accessSync(file, windows ? fs.constants.F_OK : fs.constants.X_OK);
        return io.realpathSync(file);
      }
    } catch { /* Continue through PATH. */ }
  }
  return null;
}

function npmCommand({ platform = process.platform, env = process.env, node = process.execPath, fs: io = fs } = {}) {
  const windows = platform === "win32";
  const paths = windows ? path.win32 : path.posix;
  const nodeDirectory = paths.dirname(node);
  const file = findExecutable(windows ? "npm.cmd" : "npm", { platform, env, fs: io, fallbackDirectories: [nodeDirectory] });
  // nvm 2 uses native proxy executables instead of npm.cmd on PATH.
  // POSIX Node distributions keep npm under <prefix>/lib, including nvm and
  // Homebrew's versioned Cellar directories. launchd may omit their bin from PATH.
  const script = file ? (windows ? paths.join(paths.dirname(file), "node_modules/npm/bin/npm-cli.js") : file)
    : paths.join(nodeDirectory, windows ? "" : "../lib", "node_modules/npm/bin/npm-cli.js");
  const readable = () => {
    try { io.accessSync(script, fs.constants.R_OK); return io.statSync(script).isFile(); }
    catch { return false; }
  };
  if (!file && !readable())
    throw Object.assign(new Error("未找到可用的 npm 启动入口，请使用 Node.js 原安装工具修复 npm。"), { code: "TOOL_NOT_FOUND" });
  if (paths.basename(script) !== "npm-cli.js" || !readable())
    throw new Error("未识别 npm 安装方式，请使用原安装工具管理。");
  const resolved = io.realpathSync(script);
  return { command: node, args: [resolved], script: resolved };
}

function sameFile(left, right) {
  try {
    const a = fs.realpathSync(left), b = fs.realpathSync(right);
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
  catch { return false; }
}

module.exports = { runTool, findExecutable, npmCommand, sameFile };
