<script setup>
import { computed, reactive, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";
import { translate } from "../../shared/i18n/index.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";

const props = defineProps({ projectId: { type: String, required: true }, task: { type: Object, required: true }, issues: { type: Array, required: true }, canPublish: Boolean, runKey: { type: String, default: "" } });
const emit = defineEmits(["close", "published"]);
const templates = { standard: "完成内容：\n- \n\n验证建议：\n- ", concise: "已完成：\n\n请重点检查：\n", bug: "修复内容：\n- \n\n复现与验证：\n- " };
const endpoint = `/projects/${props.projectId}`;
const rows = reactive([]);
const { data, loading, saving, error, reload, save } = useResource(async () => Promise.all(props.issues.map(async ({ id }) => {
  const issue = await appApi(`${endpoint}/issues/${id}`);
  const previous = issue.deliverySubmission?.previous;
  const delivery = previous ? (await appApi(`${endpoint}/deliveries/${previous.id}`)).delivery : null;
  return { issue, previous: delivery };
})));
watch(data, value => {
  if (!value) return;
  for (const { issue, previous } of value) {
    const existing = rows.find(row => row.issue.id === issue.id);
    if (existing) { existing.issue = issue; existing.previous = previous; }
    else rows.push({ issue, previous, body: previous?.body || translate(templates.standard), requestId: createRequestId() });
  }
  for (let index = rows.length - 1; index >= 0; index--) if (!value.some(entry => entry.issue.id === rows[index].issue.id)) rows.splice(index, 1);
});
const reviewerName = issue => issue.people?.find(person => person.id === issue.deliverySubmission?.reviewerId)?.displayName || "";
const hint = computed(() => {
  if (loading.value || !data.value) return "正在核对送验条件…";
  if (!props.canPublish) return "当前开发状态或权限不允许提交交付。";
  if (!rows.length) return "当前没有可送验的事项。";
  if (rows.some(row => !row.issue.deliverySubmission?.allowed)) return "事项状态已变化，请重新读取后提交。";
  if (rows.some(row => !reviewerName(row.issue))) return "事项未设置流程要求的验证人，请先补充负责人。";
  if (rows.some(row => !row.body.trim())) return "请填写每个事项的交付说明。";
  return "";
});
function update(row, value) { row.body = value; row.requestId = createRequestId(); }
function submit() {
  if (saving.value || hint.value) return;
  const items = rows.map(({ issue, previous, body, requestId }) => ({ requestId, issueId: issue.id, issueRevision: issue.revision, taskId: props.task.id, body,
    ...(previous ? { supersedesId: previous.id, previousRevision: previous.revision, ...(previous.commit ? { commit: previous.commit } : {}) } : {}) }));
  return save(`${endpoint}/deliveries/batch`, { items }, result => emit("published", result.items[0], result.items), "已分别提交各事项的交付与验证待办。");
}
</script>

<template>
  <form class="multi-delivery project-form" @submit.prevent="submit">
    <header class="multi-delivery-heading"><div><h2>{{ $t('事项与交付说明') }}</h2><p class="field-hint">{{ $t('逐项填写，提交后分别进入各自的验证流程。') }}</p></div><span class="field-hint">{{ $t('{count} 项待送验', { count: issues.length }) }}</span></header>
    <FeedbackMessage :message="error" type="error" />
    <button v-if="error" type="button" :disabled="saving || loading" @click="reload">{{ $t('重新读取') }}</button>
    <p v-if="loading && !data" role="status">{{ $t('正在核对送验条件…') }}</p>
    <div v-for="row in rows" :key="row.issue.id" class="multi-delivery-row">
      <div class="multi-delivery-context"><strong>#{{ row.issue.number }} {{ row.issue.title }}</strong><p class="field-hint">{{ $t('验证人') }}：{{ reviewerName(row.issue) || $t('未设置') }}</p><p v-if="row.previous?.reviewNote" class="field-hint">{{ $t('退回原因') }}：{{ row.previous.reviewNote }}</p></div>
      <div class="multi-delivery-editor"><div class="multi-delivery-templates"><strong>{{ $t('交付说明') }} <span aria-hidden="true">*</span></strong><button v-for="(value, key) in templates" :key="key" type="button" :disabled="saving" @click="update(row, translate(value))">{{ $t({ standard: '完成与验证', concise: '简洁说明', bug: '问题修复' }[key]) }}</button></div><textarea :value="row.body" :aria-label="$t('{title}的交付说明', { title: row.issue.title })" rows="5" required maxlength="50000" :disabled="saving" @input="update(row, $event.target.value)" /><p class="field-hint">{{ $t('选择模板会替换说明内容，请结合实际结果修改。') }}</p></div>
    </div>
    <footer class="multi-delivery-actions"><p class="field-hint">{{ $t('将分别生成交付，交给各事项的验证人。') }}</p><p v-if="hint && !saving" class="field-hint" role="status">{{ $t(hint) }}</p><div class="actions"><button type="button" :disabled="saving" @click="emit('close')">{{ $t(runKey ? '返回会话' : '取消') }}</button><button type="submit" class="primary" :disabled="saving || Boolean(hint)">{{ saving ? $t('正在发布…') : $t('提交全部验证') }}</button></div></footer>
  </form>
</template>
<style scoped>
.multi-delivery { max-width: 1280px; margin: auto; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); padding: 0 24px; }
.multi-delivery-heading, .multi-delivery-row { border-bottom: 1px solid var(--line); padding: 22px 0; }
.multi-delivery-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.multi-delivery-heading h2 { font-size: 18px; margin: 0 0 4px; }
.multi-delivery-heading p, .multi-delivery-context p, .multi-delivery-editor p, .multi-delivery-actions p { margin: 0; }
.multi-delivery-row { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); gap: 24px; }
.multi-delivery-context, .multi-delivery-editor { min-width: 0; overflow-wrap: anywhere; }
.multi-delivery-context p { margin-top: 8px; }
.multi-delivery-editor { display: flex; flex-direction: column; gap: 8px; }
.multi-delivery-templates { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.multi-delivery-templates strong span { color: var(--danger); }
.multi-delivery-templates button { font-size: 12px; }
.multi-delivery-editor textarea { width: 100%; resize: vertical; }
.multi-delivery-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 18px 0; }
@media (max-width: 900px) { .multi-delivery-row { grid-template-columns: minmax(0, 1fr); gap: 12px; } }
@media (max-width: 767px) { .multi-delivery { padding: 0 16px; } }
</style>
