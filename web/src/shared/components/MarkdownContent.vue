<script setup>
import { computed } from "vue";
import { renderMarkdown } from "./markdown-content.js";
import "../styles/markdown.css";
const props = defineProps({
  content: { type: String, default: "" },
  images: { type: Array, default: () => [] },
});
const html = computed(() =>
  renderMarkdown({ markdown: props.content, images: props.images }),
);
</script>
<template><div class="markdown-content" v-html="html"></div></template>
