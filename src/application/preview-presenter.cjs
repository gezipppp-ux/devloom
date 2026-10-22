function previewSummary(entry) {
  return { id: entry.id, group: entry.group, title: entry.title, version: entry.version, createdAt: entry.createdAt };
}
function previewView(entry) {
  return { ...previewSummary(entry), latest: entry.latest, revision: entry.revision,
    state: entry.state, savedAt: entry.savedAt || null,
    versions: entry.versions.map(previewSummary) };
}
function previewDocument(html, entry) {
  const initial = JSON.stringify({ state: entry.state, revision: entry.revision }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script id="devloom-preview-state" type="application/json">${initial}</script><script src="/preview-runtime.js"></script><link rel="stylesheet" href="/preview-runtime.css"></head><body>${html}</body></html>`;
}
module.exports = { previewSummary, previewView, previewDocument };
