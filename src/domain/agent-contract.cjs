const { agentConfig } = require("./agent-config.cjs");

function isBlockingRequest(request) {
  return request.kind !== "user-input" || request.blocking !== false;
}

function assertCapability(agent, capability) {
  if (agent.capabilities?.[capability] !== true)
    throw new Error(`当前执行器不支持此操作：${capability}。`);
}

function assertAgentIdentity(agent, state) {
  if (agentConfig(state).provider !== agent.id)
    throw new Error("该任务记录的执行器与当前执行器不一致，不能继续操作。");
}

module.exports = { isBlockingRequest, assertCapability, assertAgentIdentity };
