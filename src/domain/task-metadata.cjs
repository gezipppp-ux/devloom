const { types, progresses } = require("../../shared/task-metadata.json");

function defaultTaskMetadata(item = {}) {
  return {
    type: item.type === "bug" ? "bug" : "requirement",
    progress: "in_progress",
  };
}
function validateTaskMetadata(input, current = defaultTaskMetadata()) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["type", "progress"].includes(key))
  )
    throw new Error("仅允许修改任务类型和人工进度。");
  const result = { ...current, ...input };
  if (!types.some((entry) => entry.value === result.type))
    throw new Error("请选择有效的任务类型。");
  if (!progresses.some((entry) => entry.value === result.progress))
    throw new Error("请选择有效的任务进度。");
  return result;
}
module.exports = { defaultTaskMetadata, validateTaskMetadata };
