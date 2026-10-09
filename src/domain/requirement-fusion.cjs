const { createHash } = require("node:crypto");

const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_REQUIREMENTS = 20;

function validateFusion(input) {
  if (!REQUEST_ID.test(input.requestId || ""))
    throw new Error("需求操作标识无效，请重新打开表单。");
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > MAX_REQUIREMENTS)
    throw new Error("每次请选择 1–20 条需求。");
  // Retain legacy payload fingerprints when an older client supplies a mode.
  if (input.fusionMode !== undefined && !["duplicate", "sequence"].includes(input.fusionMode))
    throw new Error("无效的需求关系。");
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 200)
    throw new Error("任务标题必填，最多 200 字。");
  return {
    id: `fusion-${input.requestId}`,
    title: input.title.trim(),
    ...(input.fusionMode === undefined ? {} : { fusion_mode: input.fusionMode }),
  };
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

module.exports = { REQUEST_ID, MAX_REQUIREMENTS, validateFusion, fingerprint };
