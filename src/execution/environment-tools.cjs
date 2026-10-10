const path = require("node:path");
const { runTool, findExecutable, npmCommand, sameFile } = require("../shared/tool-process.cjs");
const { resolveCodex } = require("../codex/command.cjs");
const { childEnvironment } = require("../codex/environment.cjs");
const { toolVersion, compareVersions } = require("../domain/tool-version.cjs");
const { systemUpdatePlan, installSystemTool } = require("./system-tool-updates.cjs");

const TOOLS = [
  { id: "codex", name: "Codex CLI", requirement: "已安装并完成登录", url: "https://developers.openai.com/codex/cli/" },
  { id: "npm", name: "npm", requirement: "可用的 npm 包管理器", url: "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm" },
  { id: "git", name: "Git", requirement: "支持 git worktree（2.5.0+）", url: "https://git-scm.com/downloads" },
  { id: "node", name: "Node.js", requirement: "22.13.0+；更新目标为最新 LTS", url: "https://nodejs.org/en/download" },
];

async function inspectTool(id, { run = runTool, codex = resolveCodex, npm = npmCommand, executable = findExecutable } = {}) {
  let launch;
  if (id === "node") launch = { command: process.execPath, args: [] };
  else if (id === "codex") launch = codex();
  else if (id === "npm") launch = npm();
  else launch = { command: executable(process.platform === "win32" ? "git.exe" : "git"), args: [] };
  if (!launch.command) throw new Error("服务进程的 PATH 中未找到该工具。");
  const raw = await run(launch.command, [...launch.args, "--version"]);
  const version = toolVersion(raw);
  if (!version) throw new Error("工具返回了无法识别的版本号。");
  // Node requirements apply to the running server, even after an on-disk upgrade.
  const satisfies = id === "node" ? compareVersions(toolVersion(process.version), "22.13.0") >= 0
    : id === "git" ? compareVersions(version, "2.5.0") >= 0 : true;
  let authentication = null;
  if (id === "codex") {
    try { await run(launch.command, [...launch.args, "login", "status"]); authentication = true; }
    catch { authentication = false; }
  }
  return { version, satisfies: satisfies && authentication !== false, authentication, launch };
}

async function latestTool(id, fetchJson = remoteJson, platform = process.platform) {
  if (id === "node") {
    const releases = await fetchJson("https://nodejs.org/dist/index.json");
    const versions = releases.filter(row => row.lts && /^v\d+\.\d+\.\d+$/.test(row.version)).map(row => row.version.slice(1));
    versions.sort((a, b) => compareVersions(b, a));
    if (!versions.length) throw new Error("官方来源未返回 LTS 版本。");
    return { version: versions[0], source: "Node.js 官方 LTS" };
  }
  if (id === "git") {
    if (platform === "win32") {
      const release = await fetchJson("https://api.github.com/repos/git-for-windows/git/releases/latest");
      if (!/^v\d+\.\d+\.\d+\.windows\.\d+$/.test(release.tag_name || ""))
        throw new Error("官方来源未返回 Git for Windows 稳定版本。");
      return { version: release.tag_name.slice(1), source: "Git for Windows 官方稳定版" };
    }
    const release = await fetchJson("https://api.github.com/repos/git/git/tags?per_page=30");
    const versions = release.map(row => row.name).filter(value => /^v\d+\.\d+\.\d+$/.test(value)).map(value => value.slice(1));
    versions.sort((a, b) => compareVersions(b, a));
    if (!versions.length) throw new Error("官方来源未返回稳定版本。");
    return { version: versions[0], source: "Git 官方稳定版" };
  }
  const metadata = await fetchJson(`https://registry.npmjs.org/${id === "codex" ? "@openai%2fcodex" : "npm"}/latest`);
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version || "")) throw new Error("官方来源返回的版本号无效。");
  return { version: metadata.version, source: "npm 官方 registry", nodeEngine: metadata.engines?.node || null };
}

async function remoteJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "web-coding-environment", accept: "application/json" } });
  if (!response.ok) throw new Error(`版本来源暂不可用（HTTP ${response.status}）。`);
  return response.json();
}

async function updatePlan(id, inspected, { npm = npmCommand, run = runTool, same = sameFile, system = systemUpdatePlan } = {}) {
  if (id === "codex" || id === "npm") {
    try {
      const launch = npm();
      const globalRoot = await run(launch.command, [...launch.args, "root", "--global"]);
      const entry = id === "codex" ? path.join(globalRoot, "@openai/codex/bin/codex.js") : path.join(globalRoot, "npm/bin/npm-cli.js");
      if (!same(id === "codex" ? inspected.launch.args[0] || inspected.launch.command : launch.script, entry))
        return { available: false, reason: id === "codex" ? "当前 Codex CLI 由其他安装器或桌面应用管理，无法用 npm 覆盖该程序。" : "当前工具不属于此 npm 全局安装，暂不能自动更新。" };
      return { available: true, method: "npm", command: launch.command, args: launch.args, description: "使用当前服务账号更新 npm 全局安装。" };
    } catch { return { available: false, reason: "无法确认 npm 全局安装位置，暂不能自动更新。" }; }
  }
  return system(id, inspected);
}

async function installTool(id, version, plan, run = runTool) {
  if (["git", "node"].includes(id)) return installSystemTool(id, version, plan, run);
  if (!["codex", "npm"].includes(id) || !/^\d+\.\d+\.\d+$/.test(version) || !plan.available || plan.method !== "npm")
    throw new Error("该安装方式不支持自动更新。");
  await run(plan.command, [...plan.args, "install", "--global", `${id === "codex" ? "@openai/codex" : "npm"}@${version}`, "--registry=https://registry.npmjs.org", "--engine-strict", "--no-audit", "--no-fund"],
    { timeout: 10 * 60 * 1000, env: childEnvironment() });
}

module.exports = { TOOLS, inspectTool, latestTool, updatePlan, installTool };
