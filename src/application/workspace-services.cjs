const { defaultChannels } = require("../channels/channel-registry.cjs");
const {
  readSettings,
  saveSettings,
} = require("../config/execution-settings.cjs");
const {
  readPromptSettings,
  savePromptSettings,
} = require("../config/prompt-settings.cjs");
const {
  promptTemplateCatalog,
  MAX_PROMPT_TEMPLATE_LENGTH,
} = require("../domain/prompt-templates.cjs");
const { listBaseBranches } = require("../git/repository.cjs");
const { describeAgent } = require("./agent-presenter.cjs");
const { readRepository, mutateRepository } = require("./repository-services.cjs");

function presentPromptSettings(templates) {
  return {
    templates,
    catalog: promptTemplateCatalog,
    maxLength: MAX_PROMPT_TEMPLATE_LENGTH,
  };
}

// Application operations shared by HTTP routes. Channel payload validation
// remains inside each channel; this layer selects and composes capabilities.
class WorkspaceServices {
  constructor({ configFile, channels, sessions }) {
    this.configFile = configFile;
    this.channels = channels || defaultChannels(configFile);
    /** @type {import('./session-manager.cjs').SessionManager} */
    this.sessions = sessions;
  }

  async describe() {
    const channels = await this.channels.list();
    return {
      workspace: channels[0]?.workspace || "",
      channels,
    };
  }

  async readSettings() {
    return (await readSettings(this.configFile));
  }
  async readRepository() {
    return (await readRepository(this.configFile));
  }
  async mutateRepository(action, input) {
    return (await mutateRepository(this.configFile, action, input, () => this.sessions.authorize?.("code.operate")));
  }
  async saveSettings(input) {
    return (await saveSettings(input, this.configFile));
  }
  async readPromptSettings() {
    return presentPromptSettings((await readPromptSettings(this.configFile)));
  }
  async savePromptSettings(input) {
    return presentPromptSettings((await savePromptSettings(this.configFile, input)));
  }
  async listBaseBranches() {
    return listBaseBranches((await readSettings(this.configFile)).repository);
  }
  async listModels() {
    return (await this.sessions.agent.listModels());
  }
  async executionOptions() {
    return { agent: describeAgent(this.sessions.agent), permissionModes: await this.sessions.agent.permissionOptions(),
      ...(this.sessions.agent.currentSummary ? { nextSupplier: await this.sessions.agent.currentSummary() } : {}) };
  }
  async search(channelId, input) {
    const channel = this.channels.get(channelId);
    if (!channel.capabilities?.search)
      throw new Error("该渠道不支持需求检索。");
    return channel.search(input);
  }

  async searchUsers(channelId, input) {
    const channel = this.channels.get(channelId);
    if (!channel.capabilities?.assignees)
      throw new Error("该渠道不支持人员选择。");
    const users = await channel.searchUsers(input);
    return users.map(({ id, nick, name }) => ({ id, nick, name }));
  }

  async uploadImage(bytes) {
    return await this.channels.get("manual").uploadImage(bytes);
  }
  async startRun(input, accountSettings) {
    const selected = { ...input };
    if (accountSettings)
      for (const key of ["model", "reasoningEffort", "permissionMode"])
        if (!Object.hasOwn(selected, key))
          selected[key] = key === "permissionMode"
            ? accountSettings[key]
            : accountSettings[key] ?? "";
    return (await this.sessions.start(selected));
  }
  async imagePath(key, index) {
    return (await this.sessions.store.imagePath(key, index));
  }
  async additionImagePath(key, id, index) {
    return (await this.sessions.store.additionImagePath(key, id, index));
  }
}

module.exports = { WorkspaceServices };
