const executionFields = ["repository", "repositories", "baseBranch", "worktreeRoot",
  "initCommands", "projectName", "memberStorageRoot", "memberRoot", "gitAccountId", "remoteUrl"];

function agentConfig(configOrState = {}) {
  const current = configOrState.agent;
  if (!current || typeof current !== "object" || Array.isArray(current) ||
      typeof current.provider !== "string" || !current.provider.trim())
    throw new Error("必须明确配置 agent.provider。");
  return {
    provider: current.provider,
    model: current.model ?? "",
    reasoningEffort: current.reasoningEffort ?? "",
    permissionMode: current.permissionMode ?? "ask",
    startupTimeoutMs: current.startupTimeoutMs ?? 120000,
    options: { ...current.options },
  };
}

function executionOptions(config = {}) {
  const current = config.execution || {};
  return Object.fromEntries(executionFields.map(field => [field, current[field]]));
}

function taskPrompt(task = {}) {
  return task.prompt;
}

module.exports = { agentConfig, executionOptions, taskPrompt };
