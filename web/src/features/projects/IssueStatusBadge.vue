<script setup>
import { computed } from "vue";
import { statusHue } from "./status-color.js";
const props = defineProps({ issue: { type: Object, required: true } });
const hue = computed(() => statusHue(String(props.issue.status || ""), (props.issue.workflow?.definition?.nodes || []).map(node => node.id)));
</script>
<template><span class="ui-badge issue-status-color" :style="{ '--status-color-hue': hue }">{{ issue.statusName || issue.status }}</span></template>
<style scoped>
.issue-status-color { background: hsl(var(--status-color-hue) var(--status-color-bg-saturation) var(--status-color-bg-lightness)); color: hsl(var(--status-color-hue) var(--status-color-text-saturation) var(--status-color-text-lightness)); white-space: normal; overflow-wrap: anywhere; }
</style>
