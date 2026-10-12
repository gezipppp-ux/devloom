const { readSettings } = require("../config/execution-settings.cjs");
const { repositoryCommonDirectory } = require("../git/repository.cjs");
const { readOptional } = require("../storage/json-files.cjs");
const { databaseForPath } = require("../storage/database-registry.cjs");
const { GitAccountStore } = require("../storage/git-account-store.cjs");
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

async function repositoryContext(configFile) {
  const { repository, baseRef } = (await readSettings(configFile));
  if (!repository) throw new Error("工作区尚无项目仓库，请从 Git 远程地址创建工作区。");
  const commonDirectory = repositoryCommonDirectory(repository);
  return { repository, baseRef, commonDirectory };
}

async function readRepository(configFile) {
  const context = (await repositoryContext(configFile));
  const status = readRepositoryStatus(context.repository, context.baseRef);
  const fetched = (await readFetchState(context.commonDirectory, configFile));
  return {
    ...status,
    lastFetchedAt: fetched.fetchedAt || null,
    lastFetchedRemote: fetched.remote || null,
  };
}

async function mutateRepository(configFile, action, input, authorize = async () => {}) {
  await authorize();
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
  const context = (await repositoryContext(configFile));
  const config = (await readOptional(configFile));
  const credentials = config.execution?.gitAccountId ? {
    account: (await new GitAccountStore(databaseForPath(configFile)).read(config.execution.gitAccountId, config.workspace.owner_user_id)),
    remoteUrl: config.execution.remoteUrl,
  } : undefined;
  return (await withRepositoryOperation(context.commonDirectory, async () => {
    await authorize();
    let result;
    if (action === "fetch")
      result = await fetchRepository(context.repository, input.remote, credentials);
    else if (action === "update")
      result = await updateBaseBranch(
        context.repository,
        context.baseRef,
        input.remote,
        credentials,
        authorize,
      );
    else throw new Error("不支持的 Git 操作。");
    await authorize();
    (await writeFetchState(context.commonDirectory, result.remote, configFile));
    const status = readRepositoryStatus(context.repository, context.baseRef);
    const fetched = (await readFetchState(context.commonDirectory, configFile));
    await authorize();
    return {
      ...status,
      lastFetchedAt: fetched.fetchedAt,
      lastFetchedRemote: fetched.remote,
    };
  }));
}

module.exports = { readRepository, mutateRepository };
