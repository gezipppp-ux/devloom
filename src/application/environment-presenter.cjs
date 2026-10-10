const { compareVersions } = require("../domain/tool-version.cjs");

function presentEnvironmentTool(tool, installed, latest, plan) {
  return {
    ...tool,
    version: installed?.version || null,
    status: installed?.error ? "unknown" : installed?.satisfies ? "pass" : "fail",
    detail: installed?.error || (installed?.authentication === false ? "无法确认 Codex 已登录，请在服务账号下运行 codex login status 检查。" : installed?.satisfies ? "满足基础要求" : "版本未满足最低要求"),
    latest: latest?.version || null,
    latestStatus: latest?.error ? "error" : !latest ? "unchecked" : !installed?.version ? "unknown" : compareVersions(latest.version, installed.version) > 0 ? "available" : "current",
    latestError: latest?.error || "",
    source: latest?.source || "",
    nodeEngine: latest?.nodeEngine || null,
    updateAvailable: Boolean(plan?.available),
    updateDescription: plan?.description || "",
    restartRequired: Boolean(plan?.restartRequired),
    updateReason: plan?.reason || "未检测到可管理的安装，请按官方说明安装或修复服务 PATH 后重新检测。",
  };
}

module.exports = { presentEnvironmentTool };
