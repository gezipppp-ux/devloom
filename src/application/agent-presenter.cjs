function describeAgent(agent, provider = agent?.id) {
  const matched = agent?.id === provider;
  return {
    provider,
    label: matched ? agent.label : provider,
    capabilities: matched ? { ...agent.capabilities } : {},
  };
}

module.exports = { describeAgent };
