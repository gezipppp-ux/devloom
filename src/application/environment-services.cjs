const { TOOLS, inspectTool, latestTool, updatePlan, installTool } = require("../execution/environment-tools.cjs");
const { presentEnvironmentTool } = require("./environment-presenter.cjs");
const { writableDirectory } = require("../storage/environment-checks.cjs");
const { readSystemSettings } = require("../config/system-settings.cjs");
const { compareVersions } = require("../domain/tool-version.cjs");

class EnvironmentServices {
  constructor({ dataDirectory, manager, workspaces, workspaceClones, managers = () => [manager, ...[...(workspaces?.contexts.values() || [])].map(context => context.sessions)].filter(Boolean), cloning = () => Boolean(workspaceClones?.active.size), inspect = inspectTool, latest = latestTool, plan = updatePlan, install = installTool }) {
    Object.assign(this, { dataDirectory, managers, cloning, inspect, latest, plan, install });
    this.versions = new Map();
    this.job = null;
    this.busy = false;
    this.pending = null;
    this.closed = false;
    this.pendingNodeVersion = null;
  }

  async read() {
    const tools = await Promise.all(TOOLS.map(async tool => {
      let installed, plan;
      try { installed = await this.inspect(tool.id); plan = await this.plan(tool.id, installed); }
      catch (error) { installed = { error: error.message }; }
      if (tool.id === "node" && this.pendingNodeVersion) installed = { ...installed, version: this.pendingNodeVersion };
      return { ...presentEnvironmentTool(tool, installed, this.versions.get(tool.id), plan), pendingRestart: tool.id === "node" && Boolean(this.pendingNodeVersion) };
    }));
    const checks = [
      { name: "操作系统", status: ["win32", "linux"].includes(process.platform) ? "pass" : "warning", detail: `${process.platform} / ${process.arch}（支持 Windows、Linux）` },
      { name: "数据目录可写", status: writableDirectory(this.dataDirectory) ? "pass" : "fail", detail: "数据库与上传数据存储目录" },
      { name: "成员目录可写", status: writableDirectory((await readSystemSettings(this.dataDirectory)).memberStorageRoot) ? "pass" : "fail", detail: "项目与任务目录，未创建时检查上级目录权限" },
    ];
    return { tools, checks, runningNode: process.version, checkedAt: new Date().toISOString(), job: this.job, busy: this.busy,
      ready: tools.every(tool => tool.status === "pass") && checks.every(check => check.status === "pass") };
  }

  async checkLatest() {
    if (!this.checking) {
      this.checking = Promise.all(TOOLS.map(async tool => {
        try { this.versions.set(tool.id, { ...await this.latest(tool.id), checkedAt: new Date().toISOString() }); }
        catch (error) { this.versions.set(tool.id, { error: error.message }); }
      })).finally(() => { this.checking = null; });
    }
    await this.checking;
    return (await this.read());
  }

  assertIdle() {
    if (this.cloning()) throw new Error("仍有项目正在克隆，请完成后再更新。");
    for (const manager of this.managers()) {
      if (manager.startingRequests || manager.credentialRefresh || manager.operations?.size || [...(manager.sessions?.values() || [])].some(runtime => runtime.turnId || runtime.pipelineActive || runtime.requests?.size || ["preparing", "initializing", "starting", "running", "inProgress"].includes(runtime.status)))
        throw new Error("仍有任务正在执行或等待审批，请结束本轮后再更新。");
    }
  }

  async start(input, authorize) {
    if (!input || !["codex", "npm", "git", "node"].includes(input.id) ||
        !(input.id === "git" ? /^\d+\.\d+\.\d+(?:\.windows\.\d+)?$/ : /^\d+\.\d+\.\d+$/).test(input.version || "") || Object.keys(input).some(key => !["id", "version"].includes(key)))
      throw new Error("更新参数无效。");
    if (this.busy || this.closed) throw new Error("更新正在进行或服务正在关闭，请稍后再试。");
    if (input.id === "node" && this.pendingNodeVersion) throw new Error("Node.js 已完成安装，请先重启服务使新版本生效。");
    this.busy = true;
    try {
      this.assertIdle();
      const latest = await this.latest(input.id);
      if (latest.version !== input.version) throw new Error("最新版本已变化，请重新检查后确认更新。");
      const installed = await this.inspect(input.id);
      if (compareVersions(latest.version, installed.version) <= 0) throw new Error("当前版本无需更新。");
      const plan = await this.plan(input.id, installed);
      if (!plan.available) throw new Error(plan.reason);
      await authorize();
      this.assertIdle();
      if (this.closed) throw new Error("服务正在关闭。");
      const job = { id: input.id, version: input.version, status: "running", startedAt: new Date().toISOString(), message: "正在安装，请保持服务运行。" };
      this.job = job;
      this.pending = Promise.resolve().then(async () => {
        const result = await this.install(input.id, input.version, plan);
        const version = result?.installedVersion || (await this.inspect(input.id)).version;
        if (version !== input.version) throw new Error("安装命令已完成，但服务检测到的版本未匹配目标，请检查 PATH 和安装位置。");
        if (input.id === "node" && result?.restartRequired) this.pendingNodeVersion = input.version;
        Object.assign(job, { status: result?.restartRequired ? "restart-required" : "completed", message: result?.restartRequired
          ? "Node.js 已安装并切换，当前服务仍使用旧版本。请空闲时重启服务；跨 Node.js 主版本升级还需重新安装应用依赖。"
          : "更新完成。已有 Codex 连接使用旧进程，建议空闲时重启 Web Coding 服务。" });
      }).catch(error => Object.assign(job, { status: "failed", message: error.message + " 请重新检测环境；需要时使用服务器终端更新。" }))
        .finally(() => { job.finishedAt = new Date().toISOString(); this.busy = false; });
      return { ...job };
    } catch (error) { this.busy = false; throw error; }
  }

  status() { return { job: this.job, busy: this.busy }; }
  async close() { this.closed = true; await this.pending; }
}

module.exports = { EnvironmentServices };
