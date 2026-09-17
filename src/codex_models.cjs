function validEffort(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
}

async function listModels(client) {
  await client.connect();
  const models = new Map(),
    cursors = new Set();
  let cursor;
  for (let page = 0; page < 20; page++) {
    const result = await client.request(
      "model/list",
      {
        limit: 100,
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
      },
      15000,
    );
    if (!Array.isArray(result?.data))
      throw new Error("Codex 返回了无效的模型列表，请更新 Codex 后重试。");
    for (const entry of result.data) {
      if (
        entry.hidden ||
        typeof entry.model !== "string" ||
        !entry.model ||
        entry.model.length > 100 ||
        /[\s\0]/.test(entry.model)
      )
        continue;
      models.set(entry.model, {
        model: entry.model,
        label:
          typeof entry.displayName === "string"
            ? entry.displayName.slice(0, 200)
            : entry.model,
        reasoningEfforts: [
          ...new Set(
            (entry.supportedReasoningEfforts || [])
              .map((item) => item.reasoningEffort)
              .filter(validEffort),
          ),
        ],
        defaultReasoningEffort: validEffort(entry.defaultReasoningEffort)
          ? entry.defaultReasoningEffort
          : "",
      });
    }
    if (!result.nextCursor) return [...models.values()];
    if (typeof result.nextCursor !== "string" || cursors.has(result.nextCursor))
      throw new Error("Codex 模型列表分页异常，请重试。");
    cursor = result.nextCursor;
    cursors.add(cursor);
  }
  throw new Error("Codex 模型列表分页过多，请重试。");
}

async function validateModelSelection(client, input) {
  const model = input?.model === undefined ? "" : input.model;
  const effort =
    input?.reasoningEffort === undefined ? "" : input.reasoningEffort;
  if (
    typeof model !== "string" ||
    model.length > 100 ||
    /[\s\0]/.test(model) ||
    typeof effort !== "string" ||
    (effort && !validEffort(effort))
  )
    throw new Error("无效的模型或思考强度。");
  if (!model && effort) throw new Error("请先选择具体模型，再设置思考强度。");
  const selection = { model, reasoning_effort: effort };
  if (!model) return selection;
  const selected = (await listModels(client)).find(
    (entry) => entry.model === model,
  );
  if (!selected)
    throw new Error(
      "该模型不在当前 Codex 可用列表中，请刷新模型列表后重新选择。",
    );
  if (effort && !selected.reasoningEfforts.includes(effort))
    throw new Error("所选模型不支持该思考强度，请重新选择。");
  return selection;
}

module.exports = { listModels, validateModelSelection, validEffort };
