const stages = new Set(["validating", "connecting", "counting", "compressing", "receiving", "resolving", "checkout", "publishing"]);

// Only structured Git milestones cross the public boundary, never stderr.
function normalizeSpaceProgress(value) {
  if (!value || !stages.has(value.stage)) return null;
  const timestamp = input => typeof input === "string" && Number.isFinite(Date.parse(input)) ? new Date(input).toISOString() : null;
  return {
    stage: value.stage,
    percent: !["validating", "connecting", "publishing"].includes(value.stage) && Number.isInteger(value.percent) && value.percent >= 0 && value.percent <= 100 ? value.percent : null,
    startedAt: timestamp(value.startedAt),
    updatedAt: timestamp(value.updatedAt),
  };
}

module.exports = { normalizeSpaceProgress };
