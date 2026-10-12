const { SessionManager: ApplicationSessionManager } = require("../../src/application/session-manager.cjs");
const { createAgent } = require("../../src/agents/registry.cjs");

// Native fake clients remain useful for Codex end-to-end contract assertions.
// Only this test harness exposes them; production managers accept Agent objects.
class SessionManager extends ApplicationSessionManager {
  constructor(options) {
    const client = options.client;
    if (!client && !options.agent) throw new Error("Session tests must explicitly inject a fake Agent or client");
    super({ ...options, agent: options.agent || createAgent({ client }) });
    this.client = client;
  }
}

module.exports = { SessionManager };
