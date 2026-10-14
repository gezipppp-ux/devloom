const { WorkbenchServices } = require("./workbench-services.cjs");
const { presentActionAttention } = require("./work-action-presenter.cjs");

class AttentionServices {
  constructor(database, { projects, workspaces }) { this.workbench = new WorkbenchServices(database, projects, { workspaces }); }
  async list(actor) { return presentActionAttention(await this.workbench.actionSnapshot(actor)); }
}
module.exports = { AttentionServices };
