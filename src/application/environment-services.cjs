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
      try { installed = await this.inspect(tool.id); }
      catch (error) { installed = { error: error.message, missing: error.code === "TOOL_NOT_FOUND" }; }
      if (!installed.error || installed.missing) {
        try { plan = await this.plan(tool.id, installed); }
        catch { plan = { available: false, reason: "无法确认安装器状态，请稍后重新检测。" }; }
      }
      if (tool.id === "node" && this.pendingNodeVersion) installed = { ...installed, version: this.pendingNodeVersion };
      return { ...presentEnvironmentTool(tool, installed, this.versions.get(tool.id), plan), pendingRestart: tool.id === "node" && Boolean(this.pendingNodeVersion) };
    }));
    const checks = [
      { name: "操作系统", status: ["win32", "linux", "darwin"].includes(process.platform) ? "pass" : "warning", detail: `${process.platform} / ${process.arch}（支持 Windows、Linux、macOS）` },
      { name: "数据目录可写", status: writableDirectory(this.dataDirectory) ? "pass" : "fail", detail: "数据库与上传数据存储目录" },
      { name: "成员目录可写", status: writableDirectory((await readSystemSettings(this.dataDirectory)).memberStorageRoot) ? "pass" : "fail", detail: "项目与任务目录，未创建时检查上级目录权限" },
    ];
    return { tools, checks, runningNode: process.version, checkedAt: new Date().toISOString(), ...this.status(),
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

  async start(input, authorize, fromBatch = false) {
    if (!input || !["codex", "npm", "git", "node"].includes(input.id) ||
        !(input.id === "git" ? /^\d+\.\d+\.\d+(?:\.windows\.\d+)?$/ : /^\d+\.\d+\.\d+$/).test(input.version || "") ||
        (input.operation !== undefined && !["install", "update"].includes(input.operation)) || Object.keys(input).some(key => !["id", "version", "operation"].includes(key)))
      throw new Error("更新参数无效。");
    if (this.busy || this.closed || this.batch?.status === "running" && !fromBatch) throw new Error("更新正在进行或服务正在关闭，请稍后再试。");
    if (input.id === "node" && this.pendingNodeVersion) throw new Error("Node.js 已完成安装，请先重启服务使新版本生效。");
    this.busy = true;
    try {
      this.assertIdle();
      const operation = input.operation || "update";
      let installed;
      try { installed = await this.inspect(input.id); }
      catch (error) {
        if (error.code !== "TOOL_NOT_FOUND" || operation !== "install") throw error;
        installed = { missing: true, error: error.message };
      }
      if (operation === "install" && !installed.missing) throw new Error("已检测到工具安装，请重新检测后使用更新功能。");
      const plan = await this.plan(input.id, installed);
      if (!plan.available) throw new Error(plan.reason);
      if (operation === "install" && plan.operation !== "install") throw new Error("该安装器不支持首次安装。");
      const latest = operation === "install" && plan.targetVersion ? { version: plan.targetVersion } : await this.latest(input.id);
      if (latest.version !== input.version) throw new Error("目标版本已变化，请重新检查后确认安装或更新。");
      if (!installed.missing && compareVersions(latest.version, installed.version) <= 0) throw new Error("当前版本无需更新。");
      await authorize();
      this.assertIdle();
      if (this.closed) throw new Error("服务正在关闭。");
      const job = { id: input.id, version: input.version, operation, status: "running", startedAt: new Date().toISOString(), message: "正在安装，请保持服务运行。" };
      this.job = job;
      this.pending = Promise.resolve().then(async () => {
        const result = await this.install(input.id, input.version, plan);
        const version = result?.installedVersion || (await this.inspect(input.id)).version;
        if (version !== input.version) throw new Error("安装命令已完成，但服务检测到的版本未匹配目标，请检查 PATH 和安装位置。");
        if (input.id === "node" && result?.restartRequired) this.pendingNodeVersion = input.version;
        Object.assign(job, { status: result?.restartRequired ? "restart-required" : "completed", message: result?.restartRequired
          ? input.id === "node" ? "Node.js 已安装并切换，当前服务仍使用旧版本。请空闲时重启服务；跨 Node.js 主版本升级还需重新安装应用依赖。"
            : "Git 已安装并验证版本，请重启服务以刷新 PATH 后重新检测。"
          : operation === "install" ? input.id === "codex" ? "Codex CLI 安装完成，请在服务账号下完成 Codex 登录后重新检测。" : "安装完成，请重新检测环境。"
            : "更新完成。已有 Codex 连接使用旧进程，建议空闲时重启 Web Coding 服务。" });
      }).catch(error => Object.assign(job, { status: "failed", message: error.message + " 请重新检测环境；需要时使用服务器终端更新。" }))
        .finally(() => { job.finishedAt = new Date().toISOString(); this.busy = false; });
      return { ...job };
    } catch (error) { this.busy = false; throw error; }
  }

  async installMissing(input, authorize) {
    if (!input || Object.keys(input).some(key => key !== "tools") || !Array.isArray(input.tools) ||
        !input.tools.length || input.tools.length > 2 || new Set(input.tools.map(tool => tool?.id)).size !== input.tools.length ||
        input.tools.some(tool => !tool || !["git", "codex"].includes(tool.id) || Object.keys(tool).some(key => !["id", "version"].includes(key)) ||
          typeof tool.version !== "string" || !/^\d+\.\d+\.\d+(?:\.windows\.\d+)?$/.test(tool.version)))
      throw new Error("请选择确切版本的缺失 Git / Codex 工具。");
    if (this.status().busy || this.closed) throw new Error("已有安装正在进行或服务正在关闭。");
    // Reserve before authorization; another request must not start in this gap.
    this.batch = { status: "running", tools: [...input.tools].sort((a, b) => a.id === b.id ? 0 : a.id === "git" ? -1 : 1), completed: [], message: "正在检查安装计划。" };
    try { await authorize(); this.assertIdle(); }
    catch (error) { this.batch.status = "failed"; this.batch.message = error.message; throw error; }
    this.batchPending = (async () => {
      try {
        for (const tool of this.batch.tools) {
          await this.start({ ...tool, operation: "install" }, authorize, true);
          await this.pending;
          if (this.job.status !== "completed") { this.batch.status = this.job.status; this.batch.message = this.job.message; return; }
          this.batch.completed.push(tool.id);
        }
        this.batch.status = "completed";
        this.batch.message = "缺失工具安装完成，请重新检测；Codex 仍需服务账号完成认证。";
      } catch (error) { this.batch.status = "failed"; this.batch.message = error.message; }
    })();
    return this.status();
  }
  status() { return { job: this.job, busy: this.busy || this.batch?.status === "running", ...(this.batch ? { batch: this.batch } : {}) }; }
  async close() { this.closed = true; await this.batchPending; await this.pending; }
}

module.exports = { EnvironmentServices };
