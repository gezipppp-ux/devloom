const {
  readSystemSettings,
  saveSystemSettings,
} = require("../config/system-settings.cjs");
const { listDirectories } = require("../storage/directories.cjs");
const { gitInstallation } = require("../git/account-credentials.cjs");

class SystemServices {
  constructor(dataDirectory) {
    this.dataDirectory = dataDirectory;
  }

  async readSettings() {
    return { ...(await readSystemSettings(this.dataDirectory)), git: await gitInstallation() };
  }

  async saveSettings(input) {
    (await saveSystemSettings(input, this.dataDirectory));
    return (await this.readSettings());
  }

  async listDirectories(input) {
    return (await listDirectories(input, (await readSystemSettings(this.dataDirectory)).memberStorageRoot));
  }
}

module.exports = { SystemServices };
