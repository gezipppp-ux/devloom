<script setup>
defineProps({ title: { type: String, required: true }, description: { type: String, default: "" }, eyebrow: { type: String, default: "" } });
</script>
<template><header class="page-heading ui-page-header"><div><p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p><h1>{{ title }}</h1><p v-if="description" class="muted">{{ description }}</p><slot name="meta" /></div><div v-if="$slots.default" class="actions"><slot /></div></header></template>
