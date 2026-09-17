const path = require("node:path");
const { git } = require("../git/command.cjs");

function repositoryFor(config, configFile, workspace, channel = "tapd") {
  const selected =
    (!config.workspace &&
      config.codex?.repositories?.[`${channel}:${workspace}`]) ||
    (!config.workspace && channel === "tapd"
      ? config.codex?.repositories?.[workspace]
      : null) ||
    config.codex?.repository;
  if (!selected)
    throw new Error(
      "请先在 Web 执行设置或 codex.repository 中配置目标代码仓库。",
    );
  const repository = path.resolve(path.dirname(configFile), selected);
  const root = git(repository, ["rev-parse", "--show-toplevel"]);
  return path.resolve(root);
}

module.exports = { repositoryFor };
