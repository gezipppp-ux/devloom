<script setup>
import MarkdownContent from "../../shared/components/MarkdownContent.vue";
defineProps({ items: { type: Array, required: true }, images: { type: Array, default: () => [] } });
</script>
<template><ol v-if="items.length" class="criteria-view"><li v-for="(item, index) in items" :key="index"><MarkdownContent :content="item" :images="images" /></li></ol><p v-else class="muted">{{ $t('尚未填写。') }}</p></template>
<style scoped>.criteria-view { margin: 0; padding-left: 1.5em; display: grid; gap: 10px; }.criteria-view li { padding-left: 4px; overflow-wrap: anywhere; }</style>
