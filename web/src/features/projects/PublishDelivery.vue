<script setup>
import { createRequestId } from "../../shared/api/request-id.js";
import AppSelect from "../../shared/components/AppSelect.vue";
import { computed, reactive, ref, useId, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import PagePagination from "../../shared/components/PagePagination.vue";
import DevelopmentTaskConfirmation from "./DevelopmentTaskConfirmation.vue";
const props = defineProps({ projectId: { type: String, required: true }, runKey: { type: String, default: "" }, issueId: { type: String, default: "" }, taskId: { type: String, default: "" }, canPublish: { type: Boolean, default: true }, previous: { type: Object, default: null } });
const emit = defineEmits(["close", "published", "finished"]);
const requestId = ref(createRequestId()), additionalIssueIds = ref([]);
const form = reactive({ issueId: props.issueId, title: "", body: "", reviewerId: "", share: false });
if (props.previous) Object.assign(form, { issueId: props.previous.issueId || "", title: props.previous.title, body: props.previous.body, reviewerId: props.previous.reviewerId });
const submitHintId = useId();
const query = ref(""), offset = ref(0), selected = ref(null), finishing = ref(false);
const endpoint = '/projects/' + props.projectId;
const reviewers = useResource(() => appApi(endpoint + '/reviewers' + (form.issueId ? '?' + new URLSearchParams({ issueId: form.issueId }) : '')));
const { data, loading, saving, error, reload, save } = useResource(() => props.taskId ? appApi(endpoint + "/tasks/" + props.taskId) : props.previous ? { items: [] } : props.runKey
  ? appApi(endpoint + '/tasks/session?' + new URLSearchParams({ runKey: props.runKey }))
  : appApi(endpoint + '/issues?' + new URLSearchParams({ query: query.value, offset: String(offset.value), limit: '30' })));
const deliveryIssue = useResource(() => form.issueId ? appApi(endpoint + '/issues/' + form.issueId) : null);
watch(() => form.issueId, () => { deliveryIssue.data.value = null; void deliveryIssue.reload(); void reviewers.reload(); });
watch([form, additionalIssueIds], () => { requestId.value = createRequestId(); }, { deep: true });
const target = computed(() => deliveryIssue.data.value?.workflowActions?.find(edge => edge.trigger === 'delivery.submitted'));
const task = computed(() => data.value?.task);
const submissionAllowed = computed(() => deliveryIssue.data.value?.deliverySubmission?.allowed ?? Boolean(target.value));
const independent = computed(() => props.previous ? !props.previous.issueId : task.value?.kind === 'manual');
const issues = computed(() => task.value ? [...task.value.issues, ...task.value.additions.flatMap(batch => batch.issues || [])] : data.value?.items || []);
const eligibleIssues = computed(() => issues.value.filter(issue => issue.release?.status !== 'archived' && (task.value?.scope?.find(item => item.id === issue.id)?.submission?.allowed ?? issue.deliverySubmission?.allowed ?? true)));
watch(eligibleIssues, items => { additionalIssueIds.value = additionalIssueIds.value.filter(id => items.some(issue => issue.id === id)); });
const publishable = computed(() => props.canPublish && (!props.runKey || task.value && ['started', 'completed'].includes(task.value.status) && task.value.release?.status !== 'archived'));
const submitHint = computed(() => {
  if (loading.value || !data.value) return '正在核对送验条件…';
  if (!publishable.value) return '当前开发状态或权限不允许提交交付。';
  if (!independent.value) {
    if (!form.issueId) return '请选择关联事项。';
    if (deliveryIssue.loading.value) return '正在核对送验条件…';
    if (deliveryIssue.error.value) return '事项读取失败，请重新读取后提交。';
    if (!target.value || !submissionAllowed.value) return '此事项当前不能提交验证，请核对流程与开发范围。';
  }
  if (!form.title.trim()) return '请填写交付标题。';
  if (!form.body.trim()) return '请填写交付说明。';
  if (reviewers.loading.value) return '正在读取验证人…';
  if (reviewers.error.value) return '验证人读取失败，请重试。';
  if (!reviewers.data.value?.items?.length) return '当前没有可用的交付验证人，请联系项目负责人。';
  if (!form.reviewerId) return '请选择交付验证人。';
  if (!form.share) return '请勾选共享确认后提交。';
  return '';
});
const canSubmit = computed(() => !saving.value && !submitHint.value);
watch(task, value => { if (!value) return; if (!form.title) form.title = value.title; if (!form.issueId && value.issueIds.length === 1) form.issueId = value.issueIds[0]; });
watch(deliveryIssue.data, issue => { if (!issue) return; if (!form.title) form.title = issue.title; selected.value = issue; });
function search(next = 0) { offset.value = next; void reload(); }
function choose() { selected.value = issues.value.find(item => item.id === form.issueId) || selected.value; if (selected.value && !form.title) form.title = selected.value.title; }
function publish() {
  if (!canSubmit.value) return;
  const input = { requestId: requestId.value, ...(deliveryIssue.data.value ? { issueRevision: deliveryIssue.data.value.revision } : {}), title: form.title, body: form.body, ...(props.previous?.commit ? { commit: props.previous.commit } : {}), reviewerId: form.reviewerId,
    ...(props.previous ? { supersedesId: props.previous.id, previousRevision: props.previous.revision, taskId: deliveryIssue.data.value?.development?.taskId || props.previous.taskId } : task.value ? { taskId: task.value.id } : deliveryIssue.data.value?.development ? { taskId: deliveryIssue.data.value.development.taskId } : {}), ...(form.issueId ? { issueId: form.issueId } : {}) };
  const additional = additionalIssueIds.value.filter(id => id !== form.issueId);
  const items = [input, ...additional.map(id => ({ ...input, requestId: requestId.value + '-' + id, issueId: id, issueRevision: undefined }))];
  return save(endpoint + (additional.length ? '/deliveries/batch' : '/deliveries'), additional.length ? { items } : input, result => emit('published', additional.length ? result.items[0] : result), '交付已提交，事项和验证待办已同步更新。');
}
function finish() {
  if (!task.value?.canComplete) return;
  return save(endpoint + '/tasks/' + task.value.id + '/complete', { revision: task.value.revision }, () => { finishing.value = false; emit('finished'); }, '开发任务已完成，个人会话与代码保持私有。');
}
function close() { if (!saving.value) emit('close'); }
</script>
<template>
  <component :is="runKey ? 'section' : ModalDialog" open wide :title="deliveryIssue.data.value?.deliverySubmission?.label || $t('整理成果')" class="delivery-publish" @close="close">
    <header v-if="runKey" class="delivery-heading"><button class="ui-back" :disabled="saving" @click="close">{{ $t('← 返回会话') }}</button><h1>{{ task?.title || $t('整理成果') }}</h1><p class="muted">{{ $t('梳理开发成果，选择是否分享给项目成员。') }}</p></header>
    <FeedbackMessage :message="error" type="error" /><button v-if="error" type="button" :disabled="saving || loading" @click="reload">{{ $t('重新读取') }}</button><p v-if="loading" role="status">{{ $t('正在加载…') }}</p>
    <p v-if="data && !independent && deliveryIssue.data.value?.deliverySubmission" class="field-hint delivery-intro">{{ deliveryIssue.data.value.deliverySubmission.label }} · {{ $t('填写已完成的工作，选择验证人后送验。') }}</p>
    <form v-if="data" class="delivery-layout project-form" @submit.prevent="publish">
      <section class="delivery-editor">
        <div class="delivery-section-heading"><h2>{{ $t('成果内容') }}</h2><p class="field-hint">{{ $t('* 为必填项') }}</p></div>
        <label><span>{{ $t('交付标题') }} <span class="delivery-required" aria-hidden="true">*</span></span><input v-model="form.title" :aria-label="$t('交付标题')" required maxlength="200" :disabled="saving" /></label>
        <label><span>{{ $t('交付说明') }} <span class="delivery-required" aria-hidden="true">*</span></span><textarea v-model="form.body" :aria-label="$t('交付说明')" rows="10" required maxlength="50000" :disabled="saving" :placeholder="$t('说明完成了哪些工作，以及需要验证人重点检查的内容。')" /></label>
      </section>
      <aside class="delivery-sharing"><h2>{{ $t('送验安排') }}</h2>
        <template v-if="previous"><h3>{{ $t("重新提交交付") }}</h3><p>{{ previous.reviewNote }}</p><p class="field-hint">{{ $t("保留原交付与验收记录，以新版本再次提交验证。") }}</p></template><template v-else-if="independent"><h3>{{ $t('独立开发') }}</h3><p class="muted">{{ $t('本次开发不关联事项，可直接发布项目交付。') }}</p></template>
        <template v-else><div v-if="!runKey && !taskId && !issueId" class="ui-filter-bar"><input v-model="query" :aria-label="$t('搜索事项')" :placeholder="$t('搜索标题与描述')" :disabled="saving" @keydown.enter.prevent="search()" /><button type="button" :disabled="saving || loading" @click="search()">{{ $t('搜索') }}</button></div><PagePagination v-if="!runKey && !issueId" :offset="offset" :next-offset="data?.nextOffset" :disabled="loading || saving" @change="search" /><label><span>{{ $t('关联事项') }} <span class="delivery-required" aria-hidden="true">*</span></span><AppSelect native-events :aria-label="$t('关联事项')" v-model="form.issueId" required @change="choose" :disabled="loading || saving"><option value="" disabled>{{ $t('选择事项') }}</option><option v-if="selected && !eligibleIssues.some(item => item.id === selected.id)" :value="selected.id">#{{ selected.number }} {{ selected.title }}</option><option v-for="issue in eligibleIssues" :key="issue.id" :value="issue.id">#{{ issue.number }} {{ issue.title }}</option></AppSelect></label></template>
        <fieldset v-if="!previous && task && eligibleIssues.some(item => item.id !== form.issueId)"><legend>{{ $t('同批送验的其他事项') }}</legend><label v-for="issue in eligibleIssues.filter(item => item.id !== form.issueId)" :key="issue.id" class="ui-check-row"><input v-model="additionalIssueIds" type="checkbox" :value="issue.id" :disabled="saving" />{{ issue.title }}</label><p class="field-hint">{{ $t('每条事项独立记录交付；本批全部校验通过后一起提交。') }}</p></fieldset>
        <FeedbackMessage :message="reviewers.error.value" type="error" /><button v-if="reviewers.error.value" type="button" @click="reviewers.reload">{{ $t('重新读取验证人') }}</button><label><span>{{ $t('交付验证人') }} <span class="delivery-required" aria-hidden="true">*</span></span><AppSelect search-pinyin native-events v-model="form.reviewerId" :aria-label="$t('交付验证人')" required :disabled="saving || reviewers.loading.value"><option value="" disabled>{{ $t('选择明确的验证人') }}</option><option v-for="person in reviewers.data.value?.items || []" :key="person.id" :value="person.id">{{ person.displayName }}（{{ person.username }}）</option></AppSelect></label>
        <FeedbackMessage :message="deliveryIssue.error.value" type="error" /><button v-if="deliveryIssue.error.value" type="button" :disabled="saving || deliveryIssue.loading.value" @click="deliveryIssue.reload">{{ $t('重新读取') }}</button><p v-if="target" class="field-hint">{{ deliveryIssue.data.value.statusName }} → {{ target.statusName }} · {{ $t('交给所选验证人') }}</p>
        <label class="ui-check-row"><input v-model="form.share" type="checkbox" required :disabled="saving || !publishable" /><span>{{ $t('我确认将以上交付说明共享给有协作权限的项目成员。私人会话不会公开。') }} <span class="delivery-required" aria-hidden="true">*</span></span></label>
        <div class="delivery-submit"><p v-if="submitHint && !saving" :id="submitHintId" class="field-hint" role="status">{{ $t(submitHint) }}</p><button class="primary" type="submit" :aria-describedby="submitHint && !saving ? submitHintId : undefined" :disabled="!canSubmit">{{ saving ? $t('正在发布…') : independent ? $t('发布交付') : deliveryIssue.data.value?.deliverySubmission?.label || target?.name || $t('提交交付并送验') }}</button></div>
        <button v-if="task?.canComplete" type="button" :disabled="saving" @click="finishing = true">{{ $t('仅结束个人开发') }}</button><button type="button" :disabled="saving" @click="close">{{ $t(runKey ? '返回会话' : '取消') }}</button>
        <p class="field-hint">{{ $t(independent ? '私人会话与代码保持私有。' : '送验后保留返工能力，全部关联范围验收结束后完成开发任务。') }}</p>
      </aside>
    </form>
    <DevelopmentTaskConfirmation v-if="finishing && task" action="complete" :title="task.title" :busy="saving" :disabled="!task.canComplete" @closed="finishing = false" @confirm="finish" />
  </component>
</template>
<style scoped>
.delivery-publish { min-width: 0; }
section.delivery-publish { overflow: auto; flex: 1; min-height: 0; height: auto; padding: 28px 32px; }
.delivery-heading { max-width: 1280px; margin: 0 auto 28px; }
.delivery-heading h1 { font-size: 28px; line-height: 1.5; overflow-wrap: anywhere; }
.delivery-intro { max-width: 1280px; margin: 0 auto 20px; }
.delivery-layout.project-form { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 340px); gap: 28px; max-width: 1280px; margin: auto; align-items: start; }
section.delivery-publish .delivery-layout { padding: 28px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
.delivery-editor, .delivery-sharing { min-width: 0; display: flex; flex-direction: column; gap: 24px; }
.delivery-section-heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; }
.delivery-required { color: var(--danger); }
.delivery-submit { display: flex; flex-direction: column; gap: 8px; }
.delivery-layout h2 { font-size: 18px; margin: 0; }
.delivery-layout h3 { font-size: 14px; margin: 0; }
.delivery-layout p { margin: 0; font-size: 13px; line-height: 1.8; }
.delivery-sharing { align-self: start; border-left: 1px solid var(--line); padding-left: 24px; }
.delivery-sharing .ui-check-row { flex-direction: row; align-items: flex-start; padding: 0; }
.delivery-sharing select { max-width: 100%; }
@media (max-width: 900px) { .delivery-layout.project-form { grid-template-columns: minmax(0, 1fr); } .delivery-sharing { border-left: 0; border-top: 1px solid var(--line); padding: 24px 0 0; } }
@media (max-width: 767px) { section.delivery-publish { padding: 20px 12px; } section.delivery-publish .delivery-layout { padding: 20px 16px; } .delivery-heading h1 { font-size: 24px; } }
</style>
