const { WORKSPACE_ID, validateWorkspaceInput } = require("./workspace.cjs");
const { remoteUrl, gitAccountId } = require("./git-account.cjs");

function validateCloneInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["requestId", "name", "icon", "remoteUrl", "gitAccountId"].includes(key)))
    throw new Error("新建工作区包含未知字段。");
  if (typeof input.requestId !== "string" || !WORKSPACE_ID.test(input.requestId))
    throw new Error("无效的克隆请求标识。");
  return {
    requestId: input.requestId,
    ...validateWorkspaceInput({ name: input.name, icon: input.icon ?? null }),
    remoteUrl: remoteUrl(input.remoteUrl),
    gitAccountId: gitAccountId(input.gitAccountId),
  };
}

module.exports = { validateCloneInput };
