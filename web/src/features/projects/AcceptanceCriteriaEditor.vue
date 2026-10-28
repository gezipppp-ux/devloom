<script setup>
const props = defineProps({ modelValue: { type: Array, required: true }, disabled: Boolean });
const emit = defineEmits(["update:modelValue"]);
function replace(index, value) { emit("update:modelValue", props.modelValue.map((item, i) => i === index ? value : item)); }
function remove(index) { emit("update:modelValue", props.modelValue.filter((_, i) => i !== index)); }
</script>
<template>
  <div class="criteria-editor" role="group" :aria-label="$t('验收标准')">
    <h2>{{ $t('验收标准') }}</h2>
    <p class="field-hint">{{ $t('每条填写一个可独立判断的结果。') }}</p>
    <ol class="criteria-list">
      <li v-for="(item, index) in modelValue" :key="index">
        <span aria-hidden="true">{{ index + 1 }}.</span>
        <textarea :value="item" :disabled="disabled" required rows="2" maxlength="60000" :aria-label="$t('验收标准第 {count} 条', { count: index + 1 })" @input="replace(index, $event.target.value)" />
        <button type="button" :disabled="disabled" :aria-label="$t('删除第 {count} 条验收标准', { count: index + 1 })" @click="remove(index)">×</button>
      </li>
    </ol>
    <button type="button" :disabled="disabled" :aria-label="$t('添加一条')" @click="emit('update:modelValue', [...modelValue, ''])">＋ {{ $t('添加一条') }}</button>
  </div>
</template>
<style scoped>
.criteria-editor { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.criteria-editor h2, .criteria-editor p { margin: 0; }
.criteria-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.criteria-list li { display: grid; grid-template-columns: 28px minmax(0, 1fr) 40px; gap: 10px; align-items: start; }
.criteria-list li > span { padding-top: 10px; text-align: right; color: var(--muted); }
.criteria-list textarea { width: 100%; min-height: 58px; resize: vertical; }
.criteria-list button { width: 40px; height: 40px; padding: 0; font-size: 18px; }
.criteria-editor > button { align-self: flex-start; margin-left: 38px; }
@media (max-width: 767px) { .criteria-list li { grid-template-columns: 22px minmax(0, 1fr) 44px; gap: 6px; } .criteria-list button { width: 44px; height: 44px; } .criteria-editor > button { min-height: 44px; margin-left: 28px; } }
</style>
