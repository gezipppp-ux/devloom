const { compareVersions } = require("../domain/tool-version.cjs");

function presentEnvironmentTool(tool, installed, latest, plan) {
  return {
    ...tool,
    version: installed?.version || null,
    binaryReady: Boolean(installed?.version && !installed?.error && !installed?.missing && installed?.satisfies),
    missing: Boolean(installed?.missing),
    status: installed?.missing ? "fail" : installed?.error ? "unknown" : installed?.satisfies ? "pass" : "fail",
    detail: installed?.error || (installed?.satisfies ? "满足基础要求" : "版本未满足最低要求"),
    latest: latest?.version || null,
    latestStatus: latest?.error ? "error" : !latest ? "unchecked" : installed?.missing ? "installable" : !installed?.version ? "unknown" : compareVersions(latest.version, installed.version) > 0 ? "available" : "current",
    latestError: latest?.error || "",
    source: latest?.source || "",
    nodeEngine: latest?.nodeEngine || null,
    installAvailable: Boolean(installed?.missing && plan?.available && plan?.operation === "install"),
    installVersion: installed?.missing ? plan?.targetVersion || latest?.version || null : null,
    installSource: installed?.missing ? plan?.source || latest?.source || "" : "",
    updateAvailable: Boolean(!installed?.missing && plan?.available),
    updateDescription: plan?.description || "",
    restartRequired: Boolean(plan?.restartRequired),
    updateReason: plan?.reason || "未检测到可管理的安装，请按官方说明安装或修复服务 PATH 后重新检测。",
  };
}

module.exports = { presentEnvironmentTool };
