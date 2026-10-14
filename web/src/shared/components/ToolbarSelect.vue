<script setup>
import AppSelect from "./AppSelect.vue";
defineProps({
  modelValue: { type: String, default: "" },
  options: { type: Array, required: true },
  label: { type: String, required: true },
  iconOnly: Boolean,
  alignEnd: Boolean,
});
const emit = defineEmits(["update:modelValue"]);
</script>
<template>
  <AppSelect
    :value="modelValue"
    :options="options"
    :aria-label="label"
    :icon-only="iconOnly"
    :placement="alignEnd ? 'bottomRight' : 'bottomLeft'"
    toolbar
    @change="emit('update:modelValue', $event)"
  />
</template>
