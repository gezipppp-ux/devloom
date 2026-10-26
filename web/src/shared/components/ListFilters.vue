<script setup>
import { computed, ref } from "vue";
import { FilterOutlined } from "@antdv-next/icons";
import AppSelect from "./AppSelect.vue";
import ModalDialog from "./ModalDialog.vue";
const props = defineProps({ fields: { type: Array, required: true }, modelValue: { type: Object, required: true }, disabled: Boolean });
const emit = defineEmits(["update:modelValue", "reset"]);
const open = ref(false);
const count = computed(() => props.fields.filter(field => (props.modelValue[field.key] || []).some(value => !(field.defaultValues || []).includes(value))).length);
function change(field, values) {
  const next = values || [];
  const exclusive = field.exclusive || [];
  const added = next.find(value => !(props.modelValue[field.key] || []).includes(value));
  emit("update:modelValue", { ...props.modelValue, [field.key]: exclusive.includes(added) ? [added] : next.filter(value => !added || !exclusive.includes(value)) });
}
</script>
<template>
  <section class="list-filters" :aria-label="$t('筛选')">
    <button class="list-filters-mobile" :aria-expanded="open" @click="open = true"><FilterOutlined aria-hidden="true" />{{ $t('筛选') }}<span v-if="count"> · {{ count }}</span></button>
    <div class="list-filters-desktop">
      <div class="list-filter-fields"><label v-for="field in fields" :key="field.key"><span>{{ field.label }}</span><AppSelect multiple :aria-label="field.label" :options="field.options" :model-value="modelValue[field.key] || []" :placeholder="field.placeholder" :disabled="disabled" :allow-clear="true" :max-tag-count="1" :max-tag-text-length="16" :popup-width="280" search-pinyin @update:model-value="change(field, $event)" /></label></div>
      <div class="list-filter-footer"><span>{{ $t('不同条件同时满足，同一条件可多选。') }}</span><button v-if="count" type="button" class="list-filter-reset" :disabled="disabled" @click="emit('reset')">{{ $t('清空筛选') }}</button><slot /></div>
    </div>
    <ModalDialog v-if="open" :open="open" :title="$t('筛选')" @close="open = false">
      <div class="list-filter-fields list-filter-mobile-fields"><label v-for="field in fields" :key="field.key"><span>{{ field.label }}</span><AppSelect multiple :aria-label="field.label" :options="field.options" :model-value="modelValue[field.key] || []" :placeholder="field.placeholder" :disabled="disabled" :allow-clear="true" :max-tag-count="1" :popup-width="280" search-pinyin @update:model-value="change(field, $event)" /></label></div>
      <p class="field-hint">{{ $t('不同条件同时满足，同一条件可多选。') }}</p><slot />
      <template #footer><button :disabled="disabled" @click="emit('reset')">{{ $t('重置') }}</button><button class="primary" @click="open = false">{{ $t('查看结果') }}</button></template>
    </ModalDialog>
  </section>
</template>
<style scoped>
.list-filters { margin: 18px 0 24px; }
.list-filters-desktop { padding: 20px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.list-filter-fields { display: flex; flex-wrap: wrap; gap: 16px; }
.list-filter-fields > label { display: flex; flex-direction: column; gap: 9px; flex: 1 1 155px; min-width: 0; max-width: 260px; font-size: 12px; color: var(--muted); }
.list-filter-fields :deep(.app-select) { width: 100%; }
.list-filter-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 14px; font-size: 12px; color: var(--muted); }
.list-filter-reset { padding: 0; min-height: 28px; color: var(--highlight); border: 0; background: transparent; }
.list-filters-mobile { display: none; }
.list-filter-mobile-fields { display: grid; gap: 20px; }
.list-filter-mobile-fields > label { max-width: none; }
@media (max-width: 767px) { .list-filters-desktop { display: none; } .list-filters-mobile { display: inline-flex; gap: 8px; align-items: center; min-height: 44px; } }
</style>
