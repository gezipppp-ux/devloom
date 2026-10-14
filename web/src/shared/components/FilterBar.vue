<script setup>
defineProps({ modelValue: { type: String, default: "" }, placeholder: { type: String, default: "搜索" }, busy: Boolean });
const emit = defineEmits(["update:modelValue", "search"]);
</script>
<template><form class="ui-filter-bar" role="search" @submit.prevent="emit('search')"><div class="ui-search-field"><input type="search" :value="modelValue" :aria-label="placeholder" :placeholder="placeholder" @input="emit('update:modelValue', $event.target.value)" /><button :disabled="busy" type="submit">{{ $t("搜索") }}</button></div><slot /></form></template>
