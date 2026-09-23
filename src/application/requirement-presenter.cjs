const { sourceFor, runKey } = require("../domain/run-identity.cjs");

function presentRequirements(channelId, items, sessions) {
  const runs = new Map(sessions.map((session) => [session.key, session]));
  return items.map((item) => {
    const key = runKey(sourceFor(channelId, {
      id: item.id,
      workspace_id: item.workspace,
    }));
    const run = runs.get(key);
    return {
      ...item,
      localRun: run ? { key, progress: run.metadata.progress } : null,
    };
  });
}

module.exports = { presentRequirements };
