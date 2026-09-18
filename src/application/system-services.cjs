const {
  readSystemSettings,
  saveSystemSettings,
} = require("../config/system-settings.cjs");
const { listDirectories } = require("../storage/directories.cjs");

class SystemServices {
  constructor(dataDirectory) {
    this.dataDirectory = dataDirectory;
  }

  readSettings() {
    return readSystemSettings(this.dataDirectory);
  }

  saveSettings(input) {
    return saveSystemSettings(input, this.dataDirectory);
  }

  listDirectories(input) {
    return listDirectories(input, this.readSettings().worktreeBasePath);
  }
}

module.exports = { SystemServices };
