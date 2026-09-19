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
        isDefault: entry.isDefault === true,
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

// App-server retains per-thread overrides when a turn field is omitted/null.
// Resolve defaults to concrete values so clearing a picker actually resets it.
async function resolveTurnModel(client, selection, cwd) {
  if (selection.model && selection.reasoningEffort)
    return { model: selection.model, effort: selection.reasoningEffort };
  let config = {};
  if (!selection.model) {
    await client.connect();
    const result = await client.request("config/read", {
      cwd,
      includeLayers: false,
    });
    config = result?.config || {};
  }
  const models = await listModels(client);
  const model =
    selection.model ||
    config.model ||
    models.find((entry) => entry.isDefault)?.model;
  if (typeof model !== "string" || !model || /[\s\0]/.test(model))
    throw new Error("无法确定 Codex 默认模型，请选择具体模型后重试。");
  const selected = models.find((entry) => entry.model === model);
  const configuredEffort = !selection.model && config.model_reasoning_effort;
  const effort =
    selection.reasoningEffort ||
    configuredEffort ||
    selected?.defaultReasoningEffort;
  if (!validEffort(effort))
    throw new Error("无法确定默认思考强度，请选择具体思考强度后重试。");
  if (selected && !selected.reasoningEfforts.includes(effort))
    throw new Error("默认思考强度不受当前模型支持，请重新选择。");
  return { model, effort };
}

module.exports = {
  listModels,
  validateModelSelection,
  resolveTurnModel,
};
