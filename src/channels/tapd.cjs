const {
  loadConfig,
  loadSession,
  numericId,
  workspaceId,
} = require('../config.cjs');
const { todos, detail } = require('../tapd_direct_detail.cjs');
const { buildTask } = require('../tapd_task_package.cjs');
const { searchUsers } = require('../tapd_users.cjs');
const {
  workflowInfo,
  planTransition,
  applyTransition,
} = require('../tapd_workflow.cjs');
const { sourceFor, runKey } = require('../run_identity.cjs');

function createTapdChannel(configFile, dependencies = {}) {
  const services = {
    detail,
    buildTask,
    workflowInfo,
    applyTransition,
    searchUsers,
    ...dependencies,
  };
  return {
    id: 'tapd',
    label: 'TAPD',
    capabilities: { search: true, assignees: true },
    validate(config) {
      if (config.workflow?.allow_write !== true)
        throw new Error(
          'Set workflow.allow_write to true before executing or retrying a TAPD transition.',
        );
    },
    describe() {
      let workspace = '';
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
        scopeLabel: 'TAPD 工作区 ID',
      };
    },
    async search({ workspace, query }) {
      return (
        await todos(loadSession(configFile), {
          type: 'story',
          workspace: numericId(workspace, '工作区'),
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
          workspace: numericId(workspace, '工作区'),
          query,
        })
      ).map((user) => ({
        id: String(user.id),
        nick: user.nick,
        name: user.name,
      }));
    },
    async resolve({ id, workspace, developer, tester }) {
      const item = {
        id: numericId(id, '需求 ID'),
        workspace_id: numericId(workspace, '工作区 ID'),
        type: 'story',
      };
      const config = loadConfig(configFile),
        session = loadSession(configFile);
      for (const name of [developer, tester]) {
        if (
          typeof name !== 'string' ||
          !name.trim() ||
          name.length > 100 ||
          /[;\r\n]/.test(name)
        )
          throw new Error('请搜索并选择开发人员和测试人员。');
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
          'Set workflow.allow_write to true before executing a TAPD requirement.',
        );
      const workitem = await services.detail(session, item);
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
          'Set workflow.allow_write to true before retrying a transition.',
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
