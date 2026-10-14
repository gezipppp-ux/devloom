<script setup>
defineProps({ name: { type: String, default: "" }, tone: { type: Number, default: 0 } });
</script>
<template><span class="ui-person-avatar" :class="`ui-person-tone-${tone % 3}`" :title="name" aria-hidden="true">{{ Array.from(name.trim()).at(-1) || '—' }}</span></template>
