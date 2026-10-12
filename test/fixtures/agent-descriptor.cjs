const agentDescriptor = {
  provider: "codex",
  label: "Codex",
  capabilities: { history: true, images: true, steer: true, approvals: true, userInput: true, resume: true },
  model: "",
  reasoningEffort: "",
  permissionMode: "ask",
};

module.exports = { agentDescriptor };
