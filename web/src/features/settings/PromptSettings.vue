<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import { api } from "../../shared/api/api.js";
import FormSection from "../../shared/components/FormSection.vue";

const type = ref("requirement");
const catalog = ref({});
const maxLength = ref(20000);
const drafts = reactive({});
const savedTemplates = reactive({});
const resetDrafts = reactive({});
const loading = ref(true);
const saving = ref(false);
const loaded = ref(false);
const error = ref("");
const message = ref("");
const editor = ref();
let alive = true;
let requestId = 0;

const current = computed(() => catalog.value[type.value]);
const busy = computed(() => loading.value || saving.value);
const dirty = computed(
  () => resetDrafts[type.value] || drafts[type.value] !== savedTemplates[type.value],
);
const preview = computed(() => {
  const examples = new Map(
    (current.value?.placeholders || []).map((item) => [item.name, item.example]),
  );
  return (drafts[type.value] || "").replace(/\{\{([a-z_]+)\}\}/g, (token, name) =>
    examples.has(name) ? examples.get(name) : token,
  );
});

onMounted(load);
onUnmounted(() => {
  alive = false;
  requestId++;
});

async function load() {
  const request = ++requestId;
  loading.value = true;
  error.value = "";
  try {
    const result = await api("/settings/prompts");
    if (!alive || request !== requestId) return;
    catalog.value = result.catalog;
    maxLength.value = result.maxLength;
    for (const name of Object.keys(result.catalog)) {
      drafts[name] = savedTemplates[name] = result.templates[name];
      resetDrafts[name] = false;
    }
    loaded.value = true;
  } catch (failure) {
    if (alive && request === requestId)
      error.value = `提示词模板加载失败：${failure.message}`;
  } finally {
    if (alive && request === requestId) loading.value = false;
  }
}

function selectType(name) {
  type.value = name;
  error.value = message.value = "";
}

function edited() {
  resetDrafts[type.value] = false;
  error.value = message.value = "";
}

function reset() {
  drafts[type.value] = current.value.defaultTemplate;
  resetDrafts[type.value] = true;
  error.value = "";
  message.value = "已将默认模板填入草稿，保存后生效。";
}

function placeholderToken(name) {
  return `{{${name}}}`;
}

async function insertPlaceholder(name) {
  const field = editor.value;
  if (!field || busy.value) return;
  const token = placeholderToken(name);
  const start = field.selectionStart;
  const end = field.selectionEnd;
  const draft = drafts[type.value];
  if (draft.length - (end - start) + token.length > maxLength.value) {
    error.value = `模板最多 ${maxLength.value} 个字符，请删减后再插入。`;
    return;
  }
  drafts[type.value] = draft.slice(0, start) + token + draft.slice(end);
  edited();
  await nextTick();
  if (!alive || editor.value !== field) return;
  field.focus();
  field.setSelectionRange(start + token.length, start + token.length);
}

async function save() {
  if (!loaded.value || busy.value || !dirty.value) return;
  const name = type.value;
  const request = ++requestId;
  saving.value = true;
  error.value = message.value = "";
  try {
    const result = await api("/settings/prompts", {
      [name]: resetDrafts[name] ? null : drafts[name],
    });
    if (!alive || request !== requestId) return;
    savedTemplates[name] = drafts[name] = result.templates[name];
    resetDrafts[name] = false;
    message.value = `${catalog.value[name].label}提示词模板已保存，对新任务和新追加资料生效。`;
  } catch (failure) {
    if (alive && request === requestId)
      error.value = `保存失败：${failure.message.replace(/[。.!！?？]+$/, "")}。草稿已保留。`;
  } finally {
    if (alive && request === requestId) saving.value = false;
  }
}
</script>

<template>
  <FormSection
    id="prompt-settings"
    class="prompt-settings"
    :title="$t(&quot;提示词模板&quot;)"
    :description="$t(&quot;维护发送给 Codex 的提示词，创建任务或追加需求时自动填充占位符。&quot;)"
    :aria-busy="busy"
  >
    <p class="prompt-scope">
      {{ $t("对当前工作区的新任务和新追加资料生效；已有资料快照与会话保持原样。各模板独立保存。") }}
    </p>
    <p v-if="loading" role="status">{{ $t("正在加载提示词模板…") }}</p>
    <FeedbackMessage :message="error" type="error" />
    <button v-if="!loaded && !loading" type="button" @click="load">
      {{ $t("重新加载提示词模板") }}
    </button>
    <form v-if="loaded" @submit.prevent="save">
      <div class="prompt-types" role="group" :aria-label="$t(&quot;提示词类型&quot;)">
        <button
          v-for="(_, name) in catalog"
          :key="name"
          type="button"
          :aria-pressed="type === name"
          :disabled="busy"
          @click="selectType(name)"
        >
          {{ $t(catalog[name].label) }}
          <span
            v-if="resetDrafts[name] || drafts[name] !== savedTemplates[name]"
            class="prompt-draft-marker"
          >{{ $t("（未保存）") }}</span>
        </button>
      </div>
      <label class="prompt-editor-label" for="prompt-template-editor">
        {{ $t(current.label) }}{{ $t("提示词模板") }}
      </label>
      <textarea
        id="prompt-template-editor"
        ref="editor"
        v-model="drafts[type]"
        :aria-label="$t(&quot;提示词模板内容&quot;)"
        aria-describedby="prompt-template-hint prompt-template-count"
        rows="13"
        :maxlength="maxLength"
        :disabled="busy"
        spellcheck="false"
        @input="edited"
      />
      <div class="prompt-editor-hints">
        <p id="prompt-template-hint" class="field-hint">
          {{ $t("双花括号中的名称会替换为任务资料。保留所有必填占位符，图片和补充说明包含完整说明块。") }}
        </p>
        <span id="prompt-template-count" class="prompt-character-count">
          {{ drafts[type].length }} / {{ maxLength }}
        </span>
      </div>
      <details class="prompt-placeholders" open>
        <summary>{{ $t("可用占位符 · 点击插入") }}</summary>
        <ul>
          <li v-for="placeholder in current.placeholders" :key="placeholder.name">
            <button
              type="button"
              :disabled="busy"
              :aria-label="$t(&quot;插入占位符 {p0}&quot;, { p0: placeholder.name })"
              @mousedown.prevent
              @click="insertPlaceholder(placeholder.name)"
            >
              <code>{{ placeholderToken(placeholder.name) }}</code>
            </button>
            <span class="prompt-placeholder-label">{{ $t(placeholder.label) }}</span>
            <span v-if="placeholder.required" class="prompt-required">{{ $t("必填") }}</span>
          </li>
        </ul>
      </details>
      <details class="prompt-preview">
        <summary>{{ $t("示例预览") }}</summary>
        <p class="field-hint">{{ $t("使用示例资料预览填充结果，实际任务会使用自己的需求资料。") }}</p>
        <pre :aria-label="$t(&quot;提示词示例预览&quot;)">{{ preview }}</pre>
      </details>
      <FeedbackMessage :message="message" type="success" />
      <div class="actions">
        <button type="button" :disabled="busy" @click="reset">
          {{ $t("恢复当前类型默认模板") }}
        </button>
        <button class="primary" type="submit" :disabled="busy || !dirty">
          {{ saving ? $t("正在保存提示词…") : $t("保存提示词模板") }}
        </button>
      </div>
    </form>
  </FormSection>
</template>

<style scoped>
.prompt-settings form,
.prompt-settings textarea {
  min-width: 0;
}
.prompt-scope {
  margin: 0 0 24px;
  color: var(--muted);
  font-size: 12px;
}
.prompt-types {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
}
.prompt-types button[aria-pressed="true"] {
  color: var(--accent);
  background: var(--selected);
  border-color: var(--focus);
}
.prompt-draft-marker {
  font-size: 12px;
}
.prompt-editor-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
}
.prompt-settings textarea {
  font-family: var(--font-code);
  line-height: 1.7;
  width: 100%;
}
.prompt-editor-hints {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: baseline;
  margin: 8px 0 24px;
}
.prompt-editor-hints .field-hint {
  margin: 0;
}
.prompt-character-count {
  flex: none;
  color: var(--muted);
  font-size: 12px;
}
.prompt-placeholders,
.prompt-preview {
  margin: 0 0 24px;
  border-top: 1px solid var(--line);
  padding-top: 16px;
}
.prompt-settings summary {
  cursor: pointer;
  min-height: var(--control-height);
  padding: 8px 0;
  font-weight: 600;
}
.prompt-placeholders ul {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  list-style: none;
  gap: 12px 24px;
  padding: 0;
  margin: 8px 0 0;
}
.prompt-placeholders li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.prompt-placeholders button {
  padding: 8px;
  background: var(--soft);
}
.prompt-placeholder-label,
.prompt-required {
  font-size: 12px;
}
.prompt-placeholder-label {
  color: var(--muted);
  overflow-wrap: anywhere;
}
.prompt-required {
  color: var(--accent);
}
.prompt-preview pre {
  margin: 16px 0 0;
  padding: 16px;
  max-height: 360px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--canvas);
  font: 12px / 1.8 var(--font-code);
}
@media (max-width: 960px) {
  .prompt-placeholders ul {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .prompt-editor-hints {
    flex-direction: column;
    gap: 8px;
  }
  .prompt-settings .actions {
    flex-wrap: wrap;
  }
  .prompt-settings .actions button {
    width: 100%;
  }
}
</style>
