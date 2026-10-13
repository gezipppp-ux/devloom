const path = require("node:path");
const { runTool, findExecutable, sameFile } = require("../shared/tool-process.cjs");
const { toolVersion } = require("../domain/tool-version.cjs");
const { linuxGitInstallPlan, installLinuxGit } = require("./linux-tool-installs.cjs");

async function systemUpdatePlan(id, inspected, {
  platform = process.platform, node = process.execPath, run = runTool,
  executable = findExecutable, same = sameFile, uid,
} = {}) {
  if (platform === "linux" && id === "git" && inspected.missing) return linuxGitInstallPlan({ run, executable, uid });
  if (platform !== "win32")
    return { available: false, reason: "当前系统未接入受支持的自动安装器，请使用系统包管理器安装或更新此工具。" };
  const paths = path.win32;
  if (id === "node") {
    const nvm = executable("nvm.exe");
    if (nvm) {
      try {
        const version = await run(nvm, ["version"]);
        let directory, method;
        if (/^v?2\./.test(version)) {
          const details = JSON.parse(await run(nvm, ["env", "--json"]));
          directory = details.operations?.version_root;
          if (!same(nvm, paths.join(details.installation?.path || "", "nvm.exe")))
            throw new Error("安装位置不匹配");
          method = "nvm-windows-2";
        } else if (/^v?1\./.test(version)) {
          directory = (await run(nvm, ["root"])).replace(/^.*?Current Root:\s*/s, "").trim();
          method = "nvm-windows-1";
        }
        if (directory && paths.isAbsolute(directory) && inspected.version &&
            same(node, paths.join(directory, `v${inspected.version}`, "node.exe")))
          return { available: true, method, command: nvm, directory, restartRequired: true, description: "通过 nvm 安装并切换 Node.js，服务需重启后生效。" };
      } catch { /* A different nvm installation must not manage this Node. */ }
      return { available: false, reason: "无法确认当前 Node.js 所属的 nvm 安装，已禁用更新以免修改其他版本。" };
    }
  }
  const winget = executable("winget.exe");
  if (!winget) return { available: false, reason: "服务账号找不到 Windows 包管理器 winget，暂不能直接更新。" };
  // Match the active executable, not simply a package with the same name.
  const base = process.env.ProgramFiles || "C:\\Program Files";
  const expected = paths.join(base, id === "git" ? "Git\\cmd\\git.exe" : "nodejs\\node.exe");
  if (id === "git" && inspected.missing) {
    if (same(expected, expected)) return { available: false, reason: "默认目录已有 Git，请修复服务 PATH 后重新检测，避免重复安装。" };
    try {
      const listing = await run(winget, ["list", "--id", "Git.Git", "--exact", "--source", "winget", "--disable-interactivity"]);
      if (listing.split(/\r?\n/).some(line => line.split(/\s+/).includes("Git.Git")))
        return { available: false, reason: "Windows 包管理器已登记 Git，请修复服务 PATH 或现有安装后重新检测。" };
    } catch (error) {
      // winget uses this HRESULT when no package matches, rather than exit 0.
      if ((error.exitCode >>> 0) !== 0x8A150014) return { available: false, reason: "Windows 包管理器无法确认 Git 安装状态，请检查软件源与服务账号权限。" };
    }
    return { available: true, operation: "install", method: "winget", command: winget, packageId: "Git.Git", installedCommand: expected,
      description: "通过 Windows 包管理器安装确切版本的 Git；安装后可能需要重启服务以刷新 PATH。" };
  }
  if (!same(inspected.launch?.command || node, expected))
    return { available: false, reason: "当前工具的安装位置与受支持的 Windows 安装器不匹配，已禁用更新。" };
  const packageIds = id === "git" ? ["Git.Git"] : ["OpenJS.NodeJS.LTS", "OpenJS.NodeJS"];
  for (const packageId of packageIds) {
    try {
      const listing = await run(winget, ["list", "--id", packageId, "--exact", "--source", "winget", "--disable-interactivity"]);
      if (!listing.split(/\r?\n/).some(line => line.split(/\s+/).includes(packageId))) continue;
      return { available: true, method: "winget", command: winget, packageId, restartRequired: id === "node", description: "通过 Windows 包管理器安装确切版本；系统可能要求管理员授权。" };
    } catch { /* Try the next known package identity. */ }
  }
  return { available: false, reason: "Windows 包管理器未识别到当前安装，或其软件源不可用。" };
}

async function installSystemTool(id, version, plan, run = runTool) {
  if (id === "git" && ["apt", "dnf"].includes(plan.method)) return installLinuxGit(version, plan, run);
  if (!["node", "git"].includes(id) || !plan.available ||
      !(id === "git" ? /^\d+\.\d+\.\d+\.windows\.\d+$/ : /^\d+\.\d+\.\d+$/).test(version))
    throw new Error("系统工具更新参数无效。");
  const options = { timeout: 10 * 60 * 1000 };
  if (id === "node" && ["nvm-windows-1", "nvm-windows-2"].includes(plan.method)) {
    await run(plan.command, plan.method === "nvm-windows-2" ? ["install", "version", version] : ["install", version], options);
    const installedNode = path.win32.join(plan.directory, `v${version}`, "node.exe");
    if (toolVersion(await run(installedNode, ["--version"])) !== version)
      throw new Error("nvm 安装结束，但目标 Node.js 版本未通过验证。");
    await run(plan.command, plan.method === "nvm-windows-2" ? ["use", "version", version, "--no-install"] : ["use", version], options);
    const active = await run(plan.command, [plan.method === "nvm-windows-2" ? "default" : "current"]);
    if (toolVersion(active) !== version)
      throw new Error("Node.js 已下载，但 nvm 未切换到目标版本，请重新检测后重试。");
    return { installedVersion: version, restartRequired: true };
  }
  if (plan.method !== "winget" || !(id === "git" ? ["Git.Git"] : ["OpenJS.NodeJS.LTS", "OpenJS.NodeJS"]).includes(plan.packageId))
    throw new Error("未识别的系统安装器。");
  // Git for Windows' first build uses a three-component winget version;
  // subsequent builds use the Windows build suffix. Never install an unpinned latest.
  const versions = await run(plan.command, ["show", "--id", plan.packageId, "--exact", "--source", "winget", "--versions", "--disable-interactivity"], options);
  const available = versions.split(/\r?\n/).map(line => line.trim()).filter(line => /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(line));
  const build = version.split(".windows.");
  const candidates = id === "git" ? (build[1] === "1" ? [build[0], `${build[0]}.1`] : [`${build[0]}.${build[1]}`]) : [version];
  const target = candidates.find(candidate => available.includes(candidate));
  if (!target) throw new Error("所选版本尚未发布到 Windows 包管理器，未执行安装，请稍后重新检查。");
  await run(plan.command, [plan.operation === "install" ? "install" : "upgrade", "--id", plan.packageId, "--exact", "--source", "winget", "--version", target,
    "--silent", "--disable-interactivity", "--accept-source-agreements", "--accept-package-agreements"], options);
  if (plan.operation === "install" && id === "git") {
    const command = findExecutable("git.exe") || plan.installedCommand;
    if (toolVersion(await run(command, ["--version"])) !== version) throw new Error("Git 安装结束，但目标版本未通过验证。");
    return { installedVersion: version, restartRequired: !findExecutable("git.exe") };
  }
  return { restartRequired: id === "node" };
}

module.exports = { systemUpdatePlan, installSystemTool };
