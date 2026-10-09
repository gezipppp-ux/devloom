<script setup>
import { computed } from "vue";
import { highlightCode } from "./code-content.js";
const props = defineProps({ text: { type: String, default: "" }, path: { type: String, default: "" } });
const html = computed(() => highlightCode(props.text, props.path));
</script>
<template>
  <!-- highlight.js escapes source text and only adds syntax spans. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <code class="file-code-text" v-html="html || ' '" />
</template>
