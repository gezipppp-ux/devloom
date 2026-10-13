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
    <label>{{ definition.label }}提示词
      <textarea ref="editor" :value="modelValue" :aria-label="`${definition.label}提示词`" :disabled="disabled" :maxlength="maxLength" rows="15" spellcheck="false" @input="emit('update:modelValue', $event.target.value)" />
    </label>
    <div class="prompt-editor-hints"><p class="field-hint">保留必填占位符，运行时会填入对应的事项资料或任务补充要求。</p><span>{{ modelValue.length }} / {{ maxLength }}</span></div>
    <details class="prompt-placeholders" open>
      <summary>可用占位符 · 点击插入</summary>
      <ul><li v-for="item in definition.placeholders" :key="item.name"><button type="button" :disabled="disabled" :aria-label="`插入占位符 ${item.name}`" @mousedown.prevent @click="insert(item.name)"><code>{{ token(item.name) }}</code></button><span>{{ item.label }}</span><span v-if="item.required" class="prompt-required">必填</span></li></ul>
    </details>
    <details class="prompt-preview"><summary>示例预览</summary><p class="field-hint">以下使用示例资料；实际执行时填入对应事项或任务的内容。</p><pre aria-label="提示词示例预览">{{ preview }}</pre></details>
  </div>
</template>
<style scoped>
.prompt-template-editor { min-width: 0; }
label { display: grid; gap: 8px; }
textarea { width: 100%; min-width: 0; font-family: var(--font-code); line-height: 1.7; }
.prompt-editor-hints { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; margin: 8px 0 20px; color: var(--muted); font-size: 12px; }
.prompt-editor-hints p { margin: 0; }
details { border-top: 1px solid var(--line); padding: 12px 0; }
summary { cursor: pointer; min-height: var(--control-height); padding: 8px 0; font-weight: 600; }
ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; padding: 0; list-style: none; }
li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.prompt-required { color: var(--accent); }
pre { padding: 16px; max-height: 360px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--canvas); font: 12px / 1.8 var(--font-code); }
@media (max-width: 768px) { ul { grid-template-columns: minmax(0, 1fr); } }
</style>
