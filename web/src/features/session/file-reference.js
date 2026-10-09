// Parse references only; the server resolves and authorizes the actual worktree path.
export function fileReference(value) {
  if (typeof value !== "string" || !value || value.length > 4096) return null;
  let path;
  try { path = decodeURIComponent(value); } catch { return null; }
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null;
  if (/^[\\/]{2}|[\x00-\x1f?]/.test(path)) return null;
  const location = /(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?(?:-L?\d+)?)$/.exec(path);
  const line = location ? Number(location[1] || location[2]) : null;
  if (location) path = path.slice(0, location.index);
  if (!path || path.includes("#") || /[<>|]/.test(path)) return null;
  // A path or filename must look like a source/document file, not a command or symbol.
  if (!/(?:^|[\\/])[^\\/]+\.[a-z\d]{1,12}$/i.test(path) || /\s/.test(path) && !/[\\/]/.test(path)) return null;
  return { path, line: Number.isSafeInteger(line) && line > 0 ? line : null };
}
