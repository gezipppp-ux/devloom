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
    return { ...readSystemSettings(this.dataDirectory), git: await gitInstallation() };
  }

  async saveSettings(input) {
    saveSystemSettings(input, this.dataDirectory);
    return this.readSettings();
  }

  listDirectories(input) {
    return listDirectories(input, readSystemSettings(this.dataDirectory).memberStorageRoot);
  }
}

module.exports = { SystemServices };
