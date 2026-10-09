const { sourceFor, runKey } = require("../domain/run-identity.cjs");

function presentRequirements(channelId, items, sessions) {
  const runs = new Map(sessions.map((session) => [session.key, session]));
  for (const session of sessions)
    for (const source of session.sources || []) runs.set(runKey(source), session);
  return items.map((item) => {
    const key = runKey(sourceFor(channelId, {
      id: item.id,
      workspace_id: item.workspace,
    }));
    const run = runs.get(key);
    return {
      ...item,
      localRun: run ? { key: run.key, progress: run.metadata?.progress || "in_progress",
        title: run.title, archived: Boolean(run.archivedAt) } : null,
    };
  });
}

module.exports = { presentRequirements };
