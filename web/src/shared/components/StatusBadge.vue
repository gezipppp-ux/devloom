<script setup>
defineProps({ tone: { type: String, default: "neutral" } });
</script>
<template><span class="ui-badge" :class="`ui-badge-${tone}`"><slot /></span></template>
