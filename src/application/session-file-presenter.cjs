function fileComparison(result) {
  return { scope: result.scope, base: result.base, head: result.head };
}

function presentFileList(result) {
  return { ...fileComparison(result), files: result.files.map(({ path, previousPath, status }) => ({ path, previousPath, status })) };
}

function presentFile(result) {
  if (result.candidates) return { ...fileComparison(result), candidates: result.candidates };
  return {
    ...fileComparison(result), path: result.file, previousPath: result.previousPath,
    status: result.status, current: result.current, before: result.before,
    hunks: result.hunks, comparisonReason: result.reason,
    readAt: new Date().toISOString(),
  };
}

module.exports = { presentFileList, presentFile };
