const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { dataRoot } = require("./config.cjs");
const { readOptional, writeConfig } = require("./settings.cjs");
const { defaultChannels } = require("./channels/registry.cjs");
const { WebSessions } = require("./web_sessions.cjs");
const { validateWorkspaceIcon } = require("./workspace_icon.cjs");

const WORKSPACE_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

class Workspaces {
  constructor({
    directory = path.join(dataRoot, "workspaces"),
    createManager = (options) => new WebSessions(options),
  } = {}) {
    this.directory = path.resolve(directory);
    this.createManager = createManager;
    this.contexts = new Map();
  }

  configFile(id) {
    if (typeof id !== "string" || !WORKSPACE_ID.test(id))
      throw new Error("无效的工作区标识。");
    return path.join(this.directory, id, "config.json");
  }

  read(id) {
    const config = readOptional(this.configFile(id));
    if (config.workspace?.id !== id) {
      const error = new Error("工作区不存在。");
      error.code = "ENOENT";
      throw error;
    }
    return {
      id,
      name: config.workspace.name,
      icon: config.workspace.icon ?? null,
    };
  }

  list() {
    if (!fs.existsSync(this.directory)) return [];
    return fs
      .readdirSync(this.directory)
      .filter((id) => WORKSPACE_ID.test(id))
      .map((id) => this.read(id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  save(input, id) {
    if (
      !input ||
      Object.keys(input).some((key) => !["name", "icon"].includes(key)) ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.trim().length > 80 ||
      /[\r\n\0]/.test(input.name)
    )
      throw new Error("工作区名称必填，最多 80 字。");
    if (id) this.read(id);
    const name = input.name.trim();
    const icon =
      input.icon === undefined ? undefined : validateWorkspaceIcon(input.icon);
    if (this.list().some((entry) => entry.id !== id && entry.name === name))
      throw new Error("工作区名称已存在。");
    const key = id || randomUUID();
    const file = this.configFile(key);
    const config = id
      ? readOptional(file)
      : {
          version: 3,
          codex: {},
          workflow: {
            allow_write: false,
            target_status: "developing",
            fields: {},
          },
        };
    config.workspace = { ...config.workspace, id: key, name };
    if (icon !== undefined) config.workspace.icon = icon;
    writeConfig(file, config);
    return this.read(key);
  }

  get(id) {
    this.read(id);
    if (!this.contexts.has(id)) {
      const configFile = this.configFile(id);
      const channels = defaultChannels(configFile, {
        uploadDirectory: path.join(this.directory, id, "uploads"),
      });
      const sessions = this.createManager({
        configFile,
        channels,
        runsDirectory: path.join(this.directory, id, "runs"),
      });
      sessions.store.apiPrefix = `/api/workspaces/${id}`;
      this.contexts.set(id, {
        configFile,
        channels: sessions.channels,
        sessions,
      });
    }
    return this.contexts.get(id);
  }

  async close() {
    await Promise.all(
      [...this.contexts.values()].map(({ sessions }) => sessions.close()),
    );
  }
}

module.exports = { Workspaces, WORKSPACE_ID };
