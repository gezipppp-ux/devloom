// Native marker parsing stays in the provider. Other adapters can emit the
// same ordered {start,end,path,title} references without knowing this syntax.
function previewReferences(text) {
  const references = [];
  const pattern = /visualize([^]{1,8192})/g;
  for (const match of text.matchAll(pattern)) {
    if (references.length === 8) break;
    try {
      const value = JSON.parse(match[1]);
      if (typeof value.path !== "string" || !value.path || value.path.length > 4096) continue;
      references.push({ start: match.index, end: match.index + match[0].length,
        path: value.path, title: typeof value.title === "string" ? value.title.slice(0, 120) : "" });
    } catch { /* Malformed markers remain inert text. */ }
  }
  return references;
}
module.exports = { previewReferences };
