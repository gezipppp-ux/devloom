const promptTemplateCatalog = require("../../shared/prompt-templates.json");

const MAX_PROMPT_TEMPLATE_LENGTH = 20000;

function storedPromptOverrides(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(type => !Object.hasOwn(promptTemplateCatalog, type)))
    throw new Error("提示词配置仅支持 Bug、需求和补充提示词模板。");
  return Object.fromEntries(Object.entries(value).map(([type, template]) => [type, validatePromptTemplate(type, template)]));
}
const PLACEHOLDER = /\{\{([\s\S]*?)\}\}/g;

function validatePromptTemplate(type, template) {
  if (!Object.hasOwn(promptTemplateCatalog, type))
    throw new Error("不支持的提示词类型。");
  const definition = promptTemplateCatalog[type];
  if (
    typeof template !== "string" ||
    !template.trim() ||
    template.length > MAX_PROMPT_TEMPLATE_LENGTH
  )
    throw new Error(`${definition.label}提示词必须是非空文本，最多 20000 字。`);
  const placeholders = new Set(
    definition.placeholders.map(({ name }) => name),
  );
  const present = new Set();
  const remainder = template.replace(PLACEHOLDER, (_, name) => {
    if (!placeholders.has(name))
      throw new Error(`${definition.label}提示词包含未知占位符：{{${name}}}。`);
    present.add(name);
    return "";
  });
  if (remainder.includes("{{") || remainder.includes("}}"))
    throw new Error(`${definition.label}提示词包含未闭合或格式错误的占位符。`);
  const missing = definition.placeholders.filter(
    ({ name, required }) => required && !present.has(name),
  );
  if (missing.length)
    throw new Error(
      `${definition.label}提示词缺少必填占位符：${missing.map(({ name }) => `{{${name}}}`).join("、")}。`,
    );
  return template;
}

function getPromptTemplates(config = {}) {
  const overrides = Object.hasOwn(config, "prompt_templates")
    ? config.prompt_templates
    : {};
  storedPromptOverrides(overrides);
  return Object.fromEntries(
    Object.entries(promptTemplateCatalog).map(([type, definition]) => [
      type,
      validatePromptTemplate(
        type,
        Object.hasOwn(overrides, type)
          ? overrides[type]
          : definition.defaultTemplate,
      ),
    ]),
  );
}

function renderPromptTemplate(type, template, values) {
  validatePromptTemplate(type, template);
  // A replacement callback preserves literal $ sequences and never re-parses
  // user content or evaluates expressions embedded in a requirement.
  return template.replace(PLACEHOLDER, (_, name) => {
    if (!Object.hasOwn(values, name))
      throw new Error(`提示词占位符缺少填充值：{{${name}}}。`);
    return String(values[name] ?? "");
  });
}

module.exports = {
  promptTemplateCatalog,
  storedPromptOverrides,
  MAX_PROMPT_TEMPLATE_LENGTH,
  validatePromptTemplate,
  getPromptTemplates,
  renderPromptTemplate,
};
