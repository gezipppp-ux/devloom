const { loadConfig } = require("../../config/runtime.cjs");
const {
  getPromptTemplates,
} = require("../../domain/prompt-templates.cjs");
const { loadSession, sessionFromConfig, numericId, workspaceId } = require("./config.cjs");
const { todos, detail } = require("./detail.cjs");
const { todoRequest } = require("./auth-utils.cjs");
const { buildTask } = require("./task-package.cjs");
const { searchUsers } = require("./users.cjs");
const { readOptional } = require("../../storage/json-files.cjs");
const { sourceFor, runKey } = require("../../domain/run-identity.cjs");

function createTapdChannel(configFile, dependencies = {}) {
  function boundWorkspace(value, config = loadConfig(configFile)) {
    if (!config.workspace) return numericId(value, "TAPD 项目 ID");
    const bound = workspaceId(sessionFromConfig(config));
    if (value && String(value) !== bound)
      throw new Error(
        "TAPD 项目与当前工作区绑定不一致，请在工作区设置中修改。",
      );
    return numericId(bound, "TAPD 项目 ID");
  }
  const services = {
    detail,
    buildTask,
    searchUsers,
    ...dependencies,
  };
  return {
    id: "tapd",
    label: "TAPD",
    capabilities: { search: true, assignees: false },
    describe() {
      let workspace = "";
      try {
        workspace = workspaceId(loadSession(configFile));
      } catch {
        /* Configuration can be completed after startup. */
      }
      return {
        id: this.id,
        label: this.label,
        capabilities: this.capabilities,
        workspace,
        scopeLabel: "TAPD 项目 ID",
        scopeLocked: Boolean(readOptional(configFile).workspace),
      };
    },
    async search({ workspace, query }) {
      const session = loadSession(configFile);
      const scope = boundWorkspace(workspace);
      return (
        await todos({ ...session, request_body: todoRequest({
          workspaceId: scope,
          dscToken: session.request_body.dsc_token,
        }) }, {
          workspace: scope,
          query,
        })
      ).map((item) => ({
        id: String(item.id),
        workspace: String(item.workspace_id),
        title: item.title || item.name,
        status: item.status,
        type: String(item.entity_type || item.type || "story").toLowerCase(),
      }));
    },
    async searchUsers({ workspace, query }) {
      return (
        await services.searchUsers(loadSession(configFile), {
          workspace: boundWorkspace(workspace),
          query,
        })
      ).map((user) => ({
        id: String(user.id),
        nick: user.nick,
        name: user.name,
      }));
    },
    async resolve({
      id,
      workspace,
      type = "story",
      supplementaryInstructions = "",
    }) {
      if (
        typeof supplementaryInstructions !== "string" ||
        supplementaryInstructions.length > 60000
      )
        throw new Error("补充说明必须是文本，最多 60000 字。");
      const supplement = supplementaryInstructions.trim();
      if (!["story", "bug", "board_card"].includes(type))
        throw new Error("无效的 TAPD 待办类型。");
      const loaded = loadConfig(configFile);
      const config = {
        ...loaded,
        prompt_templates: getPromptTemplates(loaded),
      };
      const session = sessionFromConfig(config);
      const item = {
        id: numericId(id, "需求 ID"),
        workspace_id: boundWorkspace(workspace, config),
        type,
        ...(supplement ? { supplementary_instructions: supplement } : {}),
      };
      const source = sourceFor(this.id, item);
      return {
        key: runKey(source),
        source,
        item,
        session,
        config,
      };
    },
    async prepare({ session, item, directory, config }) {
      const workitem = {
        ...(await services.detail(session, item)),
        ...(item.supplementary_instructions
          ? { supplementary_instructions: item.supplementary_instructions }
          : {}),
      };
      const task = await services.buildTask(
        workitem,
        session,
        directory,
        config,
      );
      if (!task.execution_ready) throw new Error(task.blocked_reason);
      return { workitem, task };
    },
    async transition() {
      return { status: "skipped" };
    },
  };
}
module.exports = { createTapdChannel };
