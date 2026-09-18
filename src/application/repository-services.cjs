const { readSettings } = require("../config/execution-settings.cjs");
const { git } = require("../git/command.cjs");
const {
  readRepositoryStatus,
  fetchRepository,
  updateBaseBranch,
} = require("../git/repository-operations.cjs");
const {
  withRepositoryOperation,
  readFetchState,
  writeFetchState,
} = require("../storage/git-operations.cjs");

function repositoryContext(configFile) {
  const { repository, baseRef } = readSettings(configFile);
  if (!repository) throw new Error("请先在工作区设置中配置项目代码仓库。");
  const commonDirectory = git(repository, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  return { repository, baseRef, commonDirectory };
}

function readRepository(configFile) {
  const context = repositoryContext(configFile);
  const status = readRepositoryStatus(context.repository, context.baseRef);
  const fetched = readFetchState(context.commonDirectory);
  return {
    ...status,
    lastFetchedAt: fetched.fetchedAt || null,
    lastFetchedRemote: fetched.remote || null,
  };
}

async function mutateRepository(configFile, action, input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "remote") ||
    (input.remote !== undefined &&
      (typeof input.remote !== "string" || !input.remote)) ||
    (action === "fetch" && !input.remote)
  )
    throw new Error("请选择此仓库已有的远端。");
  const context = repositoryContext(configFile);
  return withRepositoryOperation(context.commonDirectory, async () => {
    let result;
    if (action === "fetch")
      result = await fetchRepository(context.repository, input.remote);
    else if (action === "update")
      result = await updateBaseBranch(
        context.repository,
        context.baseRef,
        input.remote,
      );
    else throw new Error("不支持的 Git 操作。");
    writeFetchState(context.commonDirectory, result.remote);
    const status = readRepositoryStatus(context.repository, context.baseRef);
    const fetched = readFetchState(context.commonDirectory);
    return {
      ...status,
      lastFetchedAt: fetched.fetchedAt,
      lastFetchedRemote: fetched.remote,
    };
  });
}

module.exports = { readRepository, mutateRepository };
