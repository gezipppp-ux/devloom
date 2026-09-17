const path = require("node:path");
const {
  PERMISSION_MODES,
  validatePermissionMode,
} = require("../domain/permissions.cjs");

function threadPermissionParams(value) {
  const mode = validatePermissionMode(value);
  return {
    approvalPolicy: mode === "full" ? "never" : "on-request",
    approvalsReviewer: mode === "auto" ? "auto_review" : "user",
    sandbox: mode === "full" ? "danger-full-access" : "workspace-write",
  };
}

function turnPermissionParams(mode, cwd) {
  const { approvalPolicy, approvalsReviewer, sandbox } =
    threadPermissionParams(mode);
  if (typeof cwd !== "string" || !path.isAbsolute(cwd))
    throw new Error("会话工作区路径无效，不能设置执行权限。");
  return {
    approvalPolicy,
    approvalsReviewer,
    sandboxPolicy:
      sandbox === "danger-full-access"
        ? { type: "dangerFullAccess" }
        : {
            type: "workspaceWrite",
            writableRoots: [cwd],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
  };
}

async function permissionOptions(client) {
  let autoReview = false;
  let reason = "当前 Codex 不支持自动审批，请升级后重试。";
  try {
    autoReview =
      (await client.inspectExecutionCapabilities?.())?.autoReview === true;
  } catch {
    reason = "暂时无法确认 Codex 的自动审批能力，请检查安装后刷新。";
  }
  return PERMISSION_MODES.map((mode) => ({
    ...mode,
    available: mode.id !== "auto" || autoReview,
    ...(mode.id === "auto" && !autoReview ? { reason } : {}),
  }));
}

async function assertPermissionAvailable(client, value) {
  const mode = validatePermissionMode(value);
  if (mode !== "auto") return;
  const option = (await permissionOptions(client)).find(
    ({ id }) => id === mode,
  );
  if (!option.available) throw new Error(option.reason);
}

module.exports = {
  threadPermissionParams,
  turnPermissionParams,
  permissionOptions,
  assertPermissionAvailable,
};
