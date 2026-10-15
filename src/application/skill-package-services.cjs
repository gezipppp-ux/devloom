const path = require("node:path");
const { root } = require("../config/runtime.cjs");
const { SkillPackageStore } = require("../storage/skill-package-store.cjs");
const { presentSkillDescriptor, presentSkillManifest } = require("./skill-package-presenter.cjs");

class SkillPackageServices {
  constructor(directory = path.join(root, "resources/skills/web-coding-issue-authoring")) {
    this.store = new SkillPackageStore(directory);
  }
  snapshot() {
    // One coherent release per server instance; deployments restart the service.
    this.pending ||= this.store.read().catch(error => { this.pending = null; throw error; });
    return this.pending;
  }
  async describe(origin) { return presentSkillDescriptor(await this.snapshot(), origin); }
  async manifest(origin) { return presentSkillManifest(await this.snapshot(), origin); }
  async page(origin) {
    const bundle = await this.snapshot();
    return { ...presentSkillDescriptor(bundle, origin),
      markdown: bundle.files.find(file => file.path === "SKILL.md").data.toString("utf8") };
  }
  async file(version, digest, relative) {
    const bundle = await this.snapshot();
    if (version !== bundle.version || digest !== bundle.sha256) return null;
    if (relative === "package.zip") return { data: bundle.archive, type: "application/zip", download: bundle.name + ".zip" };
    const file = bundle.files.find(file => file.path === relative);
    return file ? { data: file.data, type: relative.endsWith(".md") ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8" } : null;
  }
}

module.exports = { SkillPackageServices };
