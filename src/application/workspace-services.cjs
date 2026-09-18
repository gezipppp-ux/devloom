const { defaultChannels } = require("../channels/registry.cjs");
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
const { listBaseRefs } = require("../git/repository.cjs");
const { listModels } = require("../codex/models.cjs");
const { permissionOptions } = require("../codex/permissions.cjs");
const { readRepository, mutateRepository } = require("./repository-services.cjs");
const {
  readTapdSettings,
  saveTapdSettings,
  checkTapdSettings,
} = require("../channels/tapd/settings.cjs");

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
    this.sessions = sessions;
  }

  describe() {
    const channels = this.channels.list();
    return {
      workspace:
        channels.find((source) => source.id === "tapd")?.workspace || "",
      channels,
    };
  }

  readSettings() {
    return readSettings(this.configFile);
  }
  readRepository() {
    return readRepository(this.configFile);
  }
  mutateRepository(action, input) {
    return mutateRepository(this.configFile, action, input);
  }
  saveSettings(input) {
    return saveSettings(input, this.configFile);
  }
  readPromptSettings() {
    return presentPromptSettings(readPromptSettings(this.configFile));
  }
  savePromptSettings(input) {
    return presentPromptSettings(savePromptSettings(this.configFile, input));
  }
  listBaseRefs(repository) {
    return listBaseRefs(repository);
  }
  listModels() {
    return listModels(this.sessions.client);
  }
  async executionOptions() {
    return { permissionModes: await permissionOptions(this.sessions.client) };
  }
  readTapdSettings() {
    return readTapdSettings(this.configFile);
  }
  saveTapdSettings(input) {
    return saveTapdSettings(this.configFile, input);
  }
  checkTapdSettings(input) {
    return checkTapdSettings(this.configFile, input);
  }

  search(channelId, input) {
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

  uploadImage(bytes) {
    return this.channels.get("manual").uploadImage(bytes);
  }
  imagePath(key, index) {
    return this.sessions.store.imagePath(key, index);
  }
}

module.exports = { WorkspaceServices };
