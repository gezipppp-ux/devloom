const { loadConfig } = require("../../config/runtime.cjs");
const {
  getPromptTemplates,
} = require("../../domain/prompt-templates.cjs");
const { loadSession, sessionFromConfig, numericId, workspaceId } = require("./config.cjs");
const { todos, detail } = require("./detail.cjs");
const { todoRequest } = require("./auth-utils.cjs");
const { buildTask, prepareMaterials } = require("./task-package.cjs");
const { searchUsers } = require("./users.cjs");
const { readOptional } = require("../../storage/json-files.cjs");
const { sourceFor, runKey } = require("../../domain/run-identity.cjs");
const { validateFusion, fingerprint } = require("../../domain/requirement-fusion.cjs");
const { buildFusionTask } = require("./fusion-task.cjs");

function createTapdChannel(configFile, dependencies = {}) {
  async function boundWorkspace(value, config) {
    config ??= await loadConfig(configFile);
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
    prepareMaterials,
    searchUsers,
    ...dependencies,
  };
  return {
    id: "tapd",
    label: "TAPD",
    capabilities: { search: true, assignees: false, fusion: true },
    async describe() {
      let workspace = "";
      try {
        workspace = workspaceId((await loadSession(configFile)));
      } catch {
        /* Configuration can be completed after startup. */
      }
      return {
        id: this.id,
        label: this.label,
        capabilities: this.capabilities,
        workspace,
        scopeLabel: "TAPD 项目 ID",
        scopeLocked: Boolean((await readOptional(configFile)).workspace),
      };
    },
    async search({ workspace, query }) {
      const session = (await loadSession(configFile));
      const scope = (await boundWorkspace(workspace));
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
        await services.searchUsers((await loadSession(configFile)), {
          workspace: (await boundWorkspace(workspace)),
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
      items,
      requestId,
      title,
      fusionMode,
    }) {
      if (
        typeof supplementaryInstructions !== "string" ||
        supplementaryInstructions.length > 60000
      )
        throw new Error("补充说明必须是文本，最多 60000 字。");
      const supplement = supplementaryInstructions.trim();
      if (!["story", "bug", "board_card"].includes(type))
        throw new Error("无效的 TAPD 待办类型。");
      const loaded = (await loadConfig(configFile));
      const config = {
        ...loaded,
        prompt_templates: getPromptTemplates(loaded),
      };
      const session = sessionFromConfig(config);
      if (items !== undefined) {
        const fusion = validateFusion({ items, requestId, title, fusionMode });
        const scope = (await boundWorkspace(workspace, config));
        const requirements = items.map(entry => {
          if (!entry || (entry.type !== undefined && !["story", "bug", "board_card"].includes(entry.type)))
            throw new Error("无效的 TAPD 待办类型。");
          if (entry.workspace && String(entry.workspace) !== scope)
            throw new Error("只能融合当前 TAPD 项目的需求。");
          return { id: numericId(entry.id, "需求 ID"), workspace_id: scope,
            ...(entry.type === undefined ? {} : { type: entry.type }) };
        });
        if (new Set(requirements.map(entry => entry.id)).size !== requirements.length)
          throw new Error("请勿重复选择同一需求。");
        const item = { ...fusion, workspace_id: scope, type: "requirement", requirements,
          sources: requirements.map(entry => ({ ...sourceFor(this.id, entry), type: entry.type })),
          supplementary_instructions: supplement };
        item.request_fingerprint = fingerprint(item);
        return { item, config, session };
      }
      const item = {
        id: numericId(id, "需求 ID"),
        workspace_id: (await boundWorkspace(workspace, config)),
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
      if (item.requirements)
        return (await buildFusionTask({ session, item, directory, config, services }));
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
