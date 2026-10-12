const { readOptional, updateConfig } = require("../storage/json-files.cjs");
const {
  promptTemplateCatalog,
  getPromptTemplates,
  validatePromptTemplate,
} = require("../domain/prompt-templates.cjs");

async function readPromptSettings(configFile) {
  return getPromptTemplates((await readOptional(configFile)));
}

async function savePromptSettings(configFile, input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (channel) => !Object.hasOwn(promptTemplateCatalog, channel),
    )
  )
    throw new Error("仅允许修改手动需求、TAPD 需求和 TAPD 需求融合提示词模板。");
  for (const [channel, template] of Object.entries(input)) {
    if (template !== null) validatePromptTemplate(channel, template);
  }
  const config = (await updateConfig(configFile, (current) => {
    if (
      Object.hasOwn(current, "prompt_templates") &&
      (!current.prompt_templates ||
        typeof current.prompt_templates !== "object" ||
        Array.isArray(current.prompt_templates))
    )
      throw new Error("提示词配置必须是渠道模板对象。");
    const overrides = { ...current.prompt_templates };
    for (const [channel, template] of Object.entries(input)) {
      if (template === null) delete overrides[channel];
      else overrides[channel] = template;
    }
    const next = { ...current, prompt_templates: overrides };
    getPromptTemplates(next);
    if (!Object.keys(overrides).length) delete next.prompt_templates;
    return next;
  }));
  return getPromptTemplates(config);
}

module.exports = {
  readPromptSettings,
  savePromptSettings,
};
