const { runTool, findExecutable } = require("../shared/tool-process.cjs");
const { toolVersion } = require("../domain/tool-version.cjs");

function packageVersion(value) {
  return /^(?:\d+:)?(\d+\.\d+\.\d+)(?:-\d[\w.+~]*|\+[^\s]+)?$/.exec(value)?.[1] || null;
}

async function linuxGitInstallPlan({ run = runTool, executable = findExecutable, uid = () => process.getuid?.() } = {}) {
  if (uid() !== 0) return { available: false, reason: "Linux 系统安装 Git 需要服务账号具备 root 权限；请由运维通过系统包管理器安装，本页不会自动提权。" };
  const apt = executable("apt-get"), cache = executable("apt-cache");
  try {
    if (apt && cache) {
      const policy = await run(cache, ["policy", "git"], { env: { ...process.env, LC_ALL: "C", LANG: "C" } });
      const installed = /^\s*Installed:\s*(\S+)/m.exec(policy)?.[1];
      if (installed !== "(none)") return { available: false, reason: "系统包管理器已登记 Git 或无法确认安装状态，请修复服务 PATH 后重新检测。" };
      const target = /^\s*Candidate:\s*(\S+)/m.exec(policy)?.[1];
      if (!packageVersion(target)) throw new Error("未找到稳定候选版本");
      return { available: true, operation: "install", method: "apt", command: apt, packageVersion: target, targetVersion: packageVersion(target),
        source: "Linux APT 软件源", description: "使用当前服务账号，通过 APT 安装软件源提供的确切 Git 版本。" };
    }
    const dnf = executable("dnf"), rpm = executable("rpm");
    if (dnf && rpm) {
      try {
        await run(rpm, ["-q", "git"]);
        return { available: false, reason: "系统包管理器已登记 Git，请修复服务 PATH 后重新检测。" };
      } catch (error) { if (error.exitCode !== 1) throw error; }
      const listing = await run(dnf, ["--quiet", "repoquery", "--latest-limit", "1", "--qf", "%{evr}", "git"]);
      const candidates = [...new Set(listing.split(/\r?\n/).map(line => line.trim()).filter(value => packageVersion(value)))];
      if (candidates.length !== 1) throw new Error("候选版本不唯一");
      return { available: true, operation: "install", method: "dnf", command: dnf, packageVersion: candidates[0], targetVersion: packageVersion(candidates[0]),
        source: "Linux DNF 软件源", description: "使用当前服务账号，通过 DNF 安装软件源提供的确切 Git 版本。" };
    }
    return { available: false, reason: "Linux 自动安装 Git 支持 APT 和 DNF；当前服务未找到受支持的包管理器。" };
  } catch { return { available: false, reason: "Linux 软件源未提供可确认的稳定 Git 版本，请检查软件源、网络及包管理器后重新检测。" }; }
}

async function installLinuxGit(version, plan, run = runTool) {
  if (!plan.available || plan.operation !== "install" || packageVersion(plan.packageVersion) !== version || !["apt", "dnf"].includes(plan.method))
    throw new Error("Linux Git 安装参数无效。");
  const args = plan.method === "apt" ? ["install", "--yes", "--no-install-recommends", `git=${plan.packageVersion}`]
    : ["install", "--assumeyes", `git-${plan.packageVersion}`];
  await run(plan.command, args, { timeout: 10 * 60 * 1000, env: { ...process.env, LC_ALL: "C", LANG: "C", DEBIAN_FRONTEND: "noninteractive" } });
  const installed = toolVersion(await run("/usr/bin/git", ["--version"]));
  if (installed !== version) throw new Error("Git 安装结束，但目标版本未通过验证。");
  return { installedVersion: installed, restartRequired: !findExecutable("git") };
}

module.exports = { linuxGitInstallPlan, installLinuxGit };
