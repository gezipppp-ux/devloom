<script setup>
import { computed } from 'vue';
import { renderRequirement, safeRequirementLink } from './requirement_content';
const props = defineProps({ requirement: { type: Object, default: null } });
const html = computed(() =>
  props.requirement ? renderRequirement(props.requirement) : '',
);
const sourceUrl = computed(() =>
  safeRequirementLink(props.requirement?.sourceUrl || ''),
);
const capturedAt = computed(() => {
  const value = props.requirement?.capturedAt;
  return value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleString()
    : '';
});
</script>

<template>
  <section class="requirement-details" aria-label="完整需求资料">
    <div class="requirement-heading">
      <h2>需求正文</h2>
      <a
        v-if="sourceUrl"
        :href="sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        >查看原需求 ↗</a
      >
    </div>
    <p class="field-hint">
      <template v-if="requirement?.id">#{{ requirement.id }} · </template>
      任务启动时保存的完整快照<template v-if="capturedAt">
        · {{ capturedAt }}</template
      >
    </p>
    <p v-if="requirement?.warning" class="notice">{{ requirement.warning }}</p>
    <!-- Only the allowlisted DOMPurify output is rendered as HTML. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-if="html" class="requirement-body" v-html="html" />
    <p v-else class="muted">
      {{
        requirement
          ? '该需求没有文字描述，请查看图片附件。'
          : '需求资料尚未准备完成。'
      }}
    </p>
    <div v-if="requirement?.images?.length" class="requirement-attachments">
      <h3>图片附件 · {{ requirement.images.length }}</h3>
      <div class="image-strip">
        <a
          v-for="image in requirement.images"
          :key="image.index"
          :href="image.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            :src="image.url"
            :alt="`图片 ${image.index + 1}：${image.name}`"
            loading="lazy"
          />
          <span>图片 {{ image.index + 1 }} · 点击查看原图</span>
        </a>
      </div>
    </div>
    <details v-if="requirement?.prompt" class="requirement-prompt">
      <summary>发送给 Codex 的完整内容</summary>
      <pre>{{ requirement.prompt }}</pre>
    </details>
  </section>
</template>

<style scoped>
.requirement-details {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
  color: var(--ink);
  font-size: 13px;
}
.requirement-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
h2 {
  margin: 0;
  font-size: 16px;
}
h3 {
  font-size: 12px;
  margin: 18px 0 12px;
}
.field-hint {
  margin: 8px 0 18px;
}
a {
  color: var(--accent);
}
.requirement-body {
  line-height: 1.8;
  overflow-wrap: anywhere;
  overflow-x: auto;
}
.requirement-body :deep(img) {
  display: block;
  max-width: 100%;
  max-height: 360px;
  width: auto;
  height: auto;
  margin: 14px 0;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.requirement-body :deep(table) {
  border-collapse: collapse;
  max-width: 100%;
}
.requirement-body :deep(th),
.requirement-body :deep(td) {
  border: 1px solid var(--line);
  padding: 8px 12px;
}
.requirement-body :deep(pre),
.requirement-prompt pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--surface);
  padding: 14px;
  line-height: 1.7;
}
.requirement-body :deep(blockquote) {
  margin-left: 0;
  padding-left: 16px;
  border-left: 3px solid var(--line);
}
.requirement-attachments a {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
}
.requirement-prompt {
  margin-top: 22px;
  padding: 14px 0;
  border-top: 1px solid var(--line);
}
.requirement-prompt summary {
  font-size: 12px;
}
</style>
