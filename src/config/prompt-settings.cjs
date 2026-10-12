const { readOptional, updateConfig } = require("../storage/json-files.cjs");
const {
  promptTemplateCatalog,
  getPromptTemplates,
  storedPromptOverrides,
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
      (type) => !Object.hasOwn(promptTemplateCatalog, type),
    )
  )
    throw new Error("仅允许修改 Bug 和需求提示词模板。");
  for (const [type, template] of Object.entries(input)) {
    if (template !== null) validatePromptTemplate(type, template);
  }
  const config = (await updateConfig(configFile, (current) => {
    if (
      Object.hasOwn(current, "prompt_templates") &&
      (!current.prompt_templates ||
        typeof current.prompt_templates !== "object" ||
        Array.isArray(current.prompt_templates))
    )
      throw new Error("提示词配置必须是类型模板对象。");
    const overrides = storedPromptOverrides(current.prompt_templates);
    for (const [type, template] of Object.entries(input)) {
      if (template === null) delete overrides[type];
      else overrides[type] = template;
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
