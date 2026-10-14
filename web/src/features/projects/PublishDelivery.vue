<script setup>
import { computed, reactive, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import PagePagination from "../../shared/components/PagePagination.vue";
import DevelopmentTaskConfirmation from "./DevelopmentTaskConfirmation.vue";
const props = defineProps({ projectId: { type: String, required: true }, runKey: { type: String, default: "" }, canPublish: { type: Boolean, default: true } });
const emit = defineEmits(["close", "published", "finished"]);
const form = reactive({ issueId: "", title: "", body: "", verification: "", commit: "", share: false });
const query = ref(""), offset = ref(0), selected = ref(null), finishing = ref(false);
const endpoint = '/projects/' + props.projectId;
const { data, loading, saving, error, reload, save } = useResource(() => props.runKey
  ? appApi(endpoint + '/tasks/session?' + new URLSearchParams({ runKey: props.runKey }))
  : appApi(endpoint + '/issues?' + new URLSearchParams({ query: query.value, offset: String(offset.value), limit: '30' })));
const task = computed(() => data.value?.task);
const independent = computed(() => task.value?.kind === 'manual');
const issues = computed(() => task.value ? [...task.value.issues, ...task.value.additions.flatMap(batch => batch.issues || [])] : data.value?.items || []);
const publishable = computed(() => props.canPublish && (!props.runKey || task.value && ['started', 'completed'].includes(task.value.status) && task.value.release?.status !== 'archived'));
watch(task, value => { if (!value) return; if (!form.title) form.title = value.title; if (!form.issueId && value.issueIds.length === 1) form.issueId = value.issueIds[0]; });
function search(next = 0) { offset.value = next; void reload(); }
function choose() { selected.value = issues.value.find(item => item.id === form.issueId) || selected.value; if (selected.value && !form.title) form.title = selected.value.title; }
function publish() {
  if (!publishable.value || !form.share || !form.title.trim() || !form.body.trim() || !independent.value && !form.issueId) return;
  return save(endpoint + '/deliveries', { title: form.title, body: form.body + (form.verification.trim() ? '\n\n## 验证结果\n\n' + form.verification : ''), commit: form.commit,
    ...(task.value ? { taskId: task.value.id } : {}), ...(form.issueId ? { issueId: form.issueId } : {}) }, result => emit('published', result), '交付已发布，等待验证。');
}
function finish() {
  if (!task.value?.canComplete) return;
  return save(endpoint + '/tasks/' + task.value.id + '/complete', { revision: task.value.revision }, () => { finishing.value = false; emit('finished'); }, '开发任务已完成，个人会话与代码保持私有。');
}
function close() { if (!saving.value) emit('close'); }
</script>
<template>
  <component :is="runKey ? 'section' : ModalDialog" open wide :title="$t('整理成果')" class="delivery-publish" @close="close">
    <header v-if="runKey" class="delivery-heading"><button class="ui-back" :disabled="saving" @click="close">{{ $t('← 返回会话') }}</button><h1>{{ task?.title || $t('整理成果') }}</h1><p class="muted">{{ $t('梳理开发成果，选择是否分享给项目成员。') }}</p></header>
    <FeedbackMessage :message="error" type="error" /><button v-if="error" type="button" :disabled="saving || loading" @click="reload">{{ $t('重新读取') }}</button><p v-if="loading" role="status">{{ $t('正在加载…') }}</p>
    <form v-if="data" class="delivery-layout project-form" @submit.prevent="publish">
      <section class="delivery-editor"><h2>{{ $t('整理成果') }}</h2><label>{{ $t('交付标题') }}<input v-model="form.title" required maxlength="200" :disabled="saving" /></label><label>{{ $t('交付说明') }}<textarea v-model="form.body" rows="6" required maxlength="50000" :disabled="saving" /></label><label>{{ $t('验证结果') }}<textarea v-model="form.verification" rows="4" maxlength="10000" :disabled="saving" :placeholder="$t('填写已执行的检查、结果与尚待确认的问题。')" /></label><label>{{ $t('提交标识（可选）') }}<input v-model="form.commit" maxlength="2000" :disabled="saving" /></label></section>
      <aside class="delivery-sharing"><h2>{{ $t('发布范围') }}</h2><p>{{ $t('交付说明与填写的验证结果、提交信息将对有协作权限的项目成员可见。') }}</p>
        <template v-if="independent"><h3>{{ $t('独立开发') }}</h3><p class="muted">{{ $t('本次开发不关联事项，可直接发布项目交付。') }}</p></template>
        <template v-else><div v-if="!runKey" class="ui-filter-bar"><input v-model="query" :aria-label="$t('搜索事项')" :placeholder="$t('搜索标题与描述')" :disabled="saving" @keydown.enter.prevent="search()" /><button type="button" :disabled="saving || loading" @click="search()">{{ $t('搜索') }}</button></div><PagePagination v-if="!runKey" :offset="offset" :next-offset="data?.nextOffset" :disabled="loading || saving" @change="search" /><label>{{ $t('关联事项') }}<select :aria-label="$t('关联事项')" v-model="form.issueId" required @change="choose" :disabled="loading || saving"><option value="" disabled>{{ $t('选择事项') }}</option><option v-if="selected && !issues.some(item => item.id === selected.id)" :value="selected.id">#{{ selected.number }} {{ selected.title }}</option><option v-for="issue in issues.filter(item => item.release?.status !== 'archived')" :key="issue.id" :value="issue.id">#{{ issue.number }} {{ issue.title }}</option></select></label></template>
        <label class="ui-check-row"><input v-model="form.share" type="checkbox" :disabled="saving || !publishable" /><span>{{ $t('我确认将以上交付说明与提交信息共享给有协作权限的项目成员。私人会话不会公开。') }}</span></label>
        <button class="primary" type="submit" :disabled="saving || loading || !publishable || !form.share || !form.title.trim() || !form.body.trim() || !independent && !form.issueId">{{ saving ? $t('正在发布…') : $t('发布交付') }}</button>
        <button v-if="task?.canComplete" type="button" :disabled="saving" @click="finishing = true">{{ $t('仅结束个人开发') }}</button><button type="button" :disabled="saving" @click="close">{{ $t(runKey ? '返回会话' : '取消') }}</button>
        <p class="field-hint">{{ $t('发布交付不会合并代码、结束开发或改变事项验收状态。') }}</p>
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
.delivery-layout.project-form { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 340px); gap: 24px; max-width: 1280px; margin: auto; }
.delivery-editor, .delivery-sharing { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); padding: 24px; min-width: 0; display: flex; flex-direction: column; gap: 24px; }
.delivery-layout h2 { font-size: 18px; margin: 0; }
.delivery-layout h3 { font-size: 14px; margin: 0; }
.delivery-layout p { margin: 0; font-size: 13px; line-height: 1.8; }
.delivery-sharing { align-self: start; }
.delivery-sharing .ui-check-row { flex-direction: row; align-items: flex-start; }
.delivery-sharing select { max-width: 100%; }
@media (max-width: 900px) { .delivery-layout.project-form { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 767px) { section.delivery-publish { padding: 20px 12px; } .delivery-editor, .delivery-sharing { padding: 18px; } .delivery-heading h1 { font-size: 24px; } }
</style>
