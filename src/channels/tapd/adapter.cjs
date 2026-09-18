const { loadConfig } = require("../../config/runtime.cjs");
const {
  getPromptTemplates,
} = require("../../domain/prompt-templates.cjs");
const { loadSession, sessionFromConfig, numericId, workspaceId } = require("./config.cjs");
const { todos, detail } = require("./detail.cjs");
const { buildTask } = require("./task-package.cjs");
const { searchUsers } = require("./users.cjs");
const {
  workflowInfo,
  planTransition,
  applyTransition,
} = require("./workflow.cjs");
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
    workflowInfo,
    applyTransition,
    searchUsers,
    ...dependencies,
  };
  return {
    id: "tapd",
    label: "TAPD",
    capabilities: { search: true, assignees: true },
    validate(config) {
      if (config.workflow?.allow_write !== true)
        throw new Error(
          "Set workflow.allow_write to true before executing or retrying a TAPD transition.",
        );
    },
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
      return (
        await todos(loadSession(configFile), {
          type: "story",
          workspace: boundWorkspace(workspace),
          query,
        })
      ).map((item) => ({
        id: String(item.id),
        workspace: String(item.workspace_id),
        title: item.title || item.name,
        status: item.status,
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
      developer,
      tester,
      supplementaryInstructions = "",
    }) {
      if (
        typeof supplementaryInstructions !== "string" ||
        supplementaryInstructions.length > 60000
      )
        throw new Error("补充说明必须是文本，最多 60000 字。");
      const supplement = supplementaryInstructions.trim();
      const loaded = loadConfig(configFile);
      const config = {
        ...loaded,
        prompt_templates: getPromptTemplates(loaded),
      };
      const session = sessionFromConfig(config);
      const item = {
        id: numericId(id, "需求 ID"),
        workspace_id: boundWorkspace(workspace, config),
        type: "story",
        ...(supplement ? { supplementary_instructions: supplement } : {}),
      };
      for (const name of [developer, tester]) {
        if (
          typeof name !== "string" ||
          !name.trim() ||
          name.length > 100 ||
          /[;\r\n]/.test(name)
        )
          throw new Error("请搜索并选择开发人员和测试人员。");
        const users = await services.searchUsers(session, {
          workspace: item.workspace_id,
          query: name,
        });
        if (!users.some((user) => user.nick === name))
          throw new Error(
            `未找到精确匹配的 TAPD 用户：${name}，请重新搜索选择。`,
          );
      }
      const source = sourceFor(this.id, item);
      return {
        key: runKey(source),
        source,
        item,
        session,
        config: {
          ...config,
          workflow: {
            ...config.workflow,
            allow_write: true,
            fields: {
              ...config.workflow?.fields,
              developer: `${developer};`,
              custom_field_one: `${tester};`,
              owner: `${developer};`,
            },
          },
        },
      };
    },
    async prepare({ session, item, directory, config }) {
      if (config.workflow?.allow_write !== true)
        throw new Error(
          "Set workflow.allow_write to true before executing a TAPD requirement.",
        );
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
      const plan = planTransition(
        await services.workflowInfo(session, workitem),
        config.workflow,
      );
      return { workitem, task, target: plan.target };
    },
    async transition({ session, state, config }) {
      if (config.workflow?.allow_write !== true)
        throw new Error(
          "Set workflow.allow_write to true before retrying a transition.",
        );
      return services.applyTransition(
        session,
        state.workitem,
        config.workflow,
        state.target_status,
      );
    },
  };
}
module.exports = { createTapdChannel };
