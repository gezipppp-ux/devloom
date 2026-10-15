function presentSkillDescriptor(bundle, origin) {
  const base = new URL("/skills/" + bundle.name + "/", origin).href;
  const release = base + "releases/" + bundle.version + "/" + bundle.sha256 + "/";
  return { name: bundle.name, version: bundle.version, guideUrl: new URL("/skills", origin).href,
    manifestUrl: base + "manifest.json", entryUrl: release + "SKILL.md", packageUrl: release + "package.zip" };
}

function presentSkillManifest(bundle, origin) {
  const descriptor = presentSkillDescriptor(bundle, origin);
  return { schemaVersion: 1, ...descriptor, packageSha256: bundle.sha256, packageSize: bundle.archive.length,
    files: bundle.files.map(file => ({ path: file.path, size: file.size, sha256: file.sha256,
      url: new URL(file.path, descriptor.entryUrl).href })) };
}

module.exports = { presentSkillDescriptor, presentSkillManifest };
