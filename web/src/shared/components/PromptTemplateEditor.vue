<script setup>
import { computed, nextTick, ref } from "vue";
const props = defineProps({ modelValue: { type: String, required: true }, definition: { type: Object, required: true }, disabled: Boolean, maxLength: { type: Number, default: 20000 } });
const emit = defineEmits(["update:modelValue"]);
const editor = ref();
const preview = computed(() => props.modelValue.replace(/\{\{([a-z_]+)\}\}/g, (token, name) => props.definition.placeholders.find(item => item.name === name)?.example ?? token));
const token = name => `{{${name}}}`;
async function insert(name) {
  const field = editor.value, start = field.selectionStart, end = field.selectionEnd, value = token(name);
  if (props.modelValue.length - (end - start) + value.length > props.maxLength) return;
  emit("update:modelValue", props.modelValue.slice(0, start) + value + props.modelValue.slice(end));
  await nextTick(); field.focus(); field.setSelectionRange(start + value.length, start + value.length);
}
</script>
<template>
  <div class="prompt-template-editor">
    <label>{{ $t(definition.label) }}{{ $t("提示词") }}
      <textarea ref="editor" :value="modelValue" :aria-label="$t('{p0}提示词', { p0: definition.label })" :disabled="disabled" :maxlength="maxLength" rows="15" spellcheck="false" @input="emit('update:modelValue', $event.target.value)" />
    </label>
    <div class="prompt-editor-hints"><p class="field-hint">{{ $t("保留必填占位符，运行时会填入对应的事项资料或任务补充要求。") }}</p><span>{{ modelValue.length }} / {{ maxLength }}</span></div>
    <details class="prompt-placeholders" open>
      <summary>{{ $t("可用占位符 · 点击插入") }}</summary>
      <ul><li v-for="item in definition.placeholders" :key="item.name"><button type="button" :disabled="disabled" :aria-label="$t('插入占位符 {p0}', { p0: item.name })" @mousedown.prevent @click="insert(item.name)"><code>{{ token(item.name) }}</code></button><span>{{ $t(item.label) }}</span><span v-if="item.required" class="prompt-required">{{ $t("必填") }}</span></li></ul>
    </details>
    <details class="prompt-preview"><summary>{{ $t("示例预览") }}</summary><p class="field-hint">{{ $t("以下使用示例资料；实际执行时填入对应事项或任务的内容。") }}</p><pre :aria-label="$t('提示词示例预览')">{{ preview }}</pre></details>
  </div>
</template>
<style scoped>
.prompt-template-editor { min-width: 0; }
label { display: grid; gap: 8px; }
textarea { width: 100%; min-width: 0; min-height: 320px; padding: 16px; background: var(--canvas); font-family: var(--font-code); line-height: 1.8; tab-size: 2; }
.prompt-editor-hints { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; margin: 8px 0 20px; color: var(--muted); font-size: 12px; }
.prompt-editor-hints p { margin: 0; }
details { border-top: 1px solid var(--line); padding: 12px 0; }
summary { cursor: pointer; min-height: var(--control-height); padding: 8px 0; font-weight: 600; }
ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; margin: 12px 0 4px; padding: 0; list-style: none; }
li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
li button { min-width: 0; padding: 6px 10px; border-color: var(--line); background: var(--surface); font-size: 12px; }
li code { white-space: normal; overflow-wrap: anywhere; }
.prompt-required { padding: 2px 6px; border-radius: 4px; background: var(--selected); color: var(--highlight); }
pre { padding: 16px; max-height: 360px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--canvas); font: 12px / 1.8 var(--font-code); }
@media (max-width: 768px) { ul { grid-template-columns: minmax(0, 1fr); } }
</style>
