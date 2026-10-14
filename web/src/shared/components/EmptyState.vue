<script setup>
defineProps({ title: { type: String, default: "暂无内容" }, description: { type: String, default: "" } });
</script>
<template><div class="ui-empty" role="status"><span class="ui-empty-mark" aria-hidden="true">◇</span><h2>{{ title }}</h2><p v-if="description">{{ description }}</p><slot /></div></template>
