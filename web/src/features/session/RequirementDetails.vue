<script setup>
import { formatDate } from "../../shared/i18n/index.js";
import { computed } from 'vue';
import { renderRequirement, safeRequirementLink } from './requirement-content.js';
const props = defineProps({ requirement: { type: Object, default: null }, disabled: Boolean, nested: Boolean });
const emit = defineEmits(['continue']);
const html = computed(() =>
  props.requirement ? renderRequirement(props.requirement) : '',
);
const sourceUrl = computed(() =>
  safeRequirementLink(props.requirement?.sourceUrl || ''),
);
const capturedAt = computed(() => {
  const value = props.requirement?.capturedAt;
  return value && !Number.isNaN(Date.parse(value))
    ? formatDate(value, { hour: "2-digit", minute: "2-digit" })
    : '';
});
</script>

<template>
  <section class="requirement-details" :aria-label="$t(&quot;完整需求资料&quot;)">
    <div class="requirement-heading">
      <h2>{{ requirement?.requirements?.length ? requirement.title : $t("需求正文") }}</h2>
      <a
        v-if="sourceUrl"
        :href="sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        >{{ $t("查看原需求 ↗") }}</a
      >
    </div>
    <p class="field-hint">
      <template v-if="requirement?.id && !requirement?.requirements?.length">#{{ requirement.id }} · </template>
      {{ nested ? $t("完整资料快照") : $t("任务启动时保存的完整快照") }}<template v-if="capturedAt">
        · {{ capturedAt }}</template
      >
    </p>
    <p v-if="requirement?.warning" class="notice">{{ requirement.warning }}</p>
    <!-- Only the allowlisted DOMPurify output is rendered as HTML. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-if="html" class="requirement-body" v-html="html" />
    <p v-else-if="!requirement?.requirements?.length" class="muted">
      {{
        requirement
          ? $t("该需求没有原始文字描述，请查看补充说明或图片附件。")
          : $t("需求资料尚未准备完成。")
      }}
    </p>
    <section
      v-if="requirement?.supplementaryInstructions"
      class="requirement-supplement"
      :aria-label="$t(&quot;补充说明与指导意见&quot;)"
    >
      <h3>{{ $t("补充说明与指导意见") }}</h3>
      <pre>{{ requirement.supplementaryInstructions }}</pre>
    </section>
    <details v-for="(child, index) in requirement?.requirements || []" :key="child.id" class="requirement-source">
      <summary>{{ index + 1 }}. {{ child.title }} · #{{ child.id }}</summary>
      <RequirementDetails :requirement="child" nested />
    </details>
    <div v-if="requirement?.images?.length && !requirement?.requirements?.length" class="requirement-attachments">
      <h3>{{ $t("图片附件 ·") }} {{ requirement.images.length }}</h3>
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
          <span>{{ $t("图片") }} {{ image.index + 1 }} {{ $t("· 点击查看原图") }}</span>
        </a>
      </div>
    </div>
    <details v-if="requirement?.prompt" class="requirement-prompt">
      <summary>{{ nested ? $t("本批资料的完整提示词") : $t("发送给 Codex 的完整内容") }}</summary>
      <pre>{{ requirement.prompt }}</pre>
    </details>
    <section v-for="(addition, index) in requirement?.additions || []" :key="addition.id" class="requirement-addition">
      <h3>{{ $t("追加资料") }} {{ index + 1 }} · {{ addition.status === 'ready' ? $t("待处理") : addition.status === 'sent' ? $t("已发送") : $t("发送结果待确认") }}</h3>
      <RequirementDetails :requirement="addition.requirement" nested />
      <button v-if="addition.status === 'ready'" type="button" class="primary" :disabled="disabled" @click="emit('continue', addition.id)">{{ $t("继续处理新增需求") }}</button>
      <p v-else-if="addition.status !== 'sent'" class="notice">{{ $t("请检查会话历史后通过消息继续；系统不会自动重发这批资料。") }}</p>
    </section>
  </section>
</template>

<style scoped>
.requirement-details {
  color: var(--ink);
  font-size: 13px;
}
.requirement-source, .requirement-addition { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line); }
.requirement-source summary { overflow-wrap: anywhere; cursor: pointer; margin-bottom: 12px; }
.requirement-heading {
  display: flex;
  flex-wrap: wrap;
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
.requirement-supplement pre,
.requirement-prompt pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--surface);
  padding: 14px;
  line-height: 1.7;
}
.requirement-supplement pre {
  font: inherit;
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
