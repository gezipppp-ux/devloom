const path = require("node:path");
const { repositoryRoot } = require("../git/repository.cjs");
const { executionOptions } = require("../domain/agent-config.cjs");

function repositoryFor(config, configFile, workspace, channel = "tapd") {
  const execution = executionOptions(config);
  const selected =
    (!config.workspace &&
      execution.repositories?.[`${channel}:${workspace}`]) ||
    (!config.workspace && channel === "tapd"
      ? execution.repositories?.[workspace]
      : null) ||
    execution.repository;
  if (!selected)
    throw new Error(
      "请先在 Web 执行设置或 execution.repository 中配置目标代码仓库。",
    );
  const repository = path.resolve(path.dirname(configFile), selected);
  return repositoryRoot(repository);
}

module.exports = { repositoryFor };
