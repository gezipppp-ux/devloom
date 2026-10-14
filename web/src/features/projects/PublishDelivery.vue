<script setup>
import { reactive, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import MarkdownEditor from "../../shared/components/MarkdownEditor.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import PagePagination from "../../shared/components/PagePagination.vue";
const props = defineProps({ projectId: { type: String, required: true } });
const emit = defineEmits(["close", "published"]);
const form = reactive({ issueId: "", title: "", body: "", commit: "", share: false });
const query = ref(""), offset = ref(0), selected = ref(null);
const { data, loading, saving, error, reload, save } = useResource(() => appApi('/projects/' + props.projectId + '/issues?' + new URLSearchParams({ query: query.value, offset: String(offset.value), limit: '30' })));
function search(next = 0) { offset.value = next; void reload(); }
function choose() { selected.value = data.value?.items.find(item => item.id === form.issueId) || selected.value; if (selected.value && !form.title) form.title = selected.value.title; }
watch(() => props.projectId, () => { Object.assign(form, { issueId: '', title: '', body: '', commit: '', share: false }); selected.value = null; search(); });
function publish() {
  if (!form.share || !form.issueId) return;
  return save('/projects/' + props.projectId + '/issues/' + form.issueId + '/deliverables', { title: form.title, body: form.body, commit: form.commit }, result => emit('published', result), '交付已发布，等待验证。');
}
</script>
<template><ModalDialog open wide :title="$t('发布交付')" @close="emit('close')"><FeedbackMessage :message="error" type="error" /><button v-if="error && !data" @click="reload">{{ $t('重试') }}</button><form class="project-form" @submit.prevent="publish"><div class="ui-filter-bar"><input v-model="query" :aria-label="$t('搜索事项')" :placeholder="$t('搜索标题与描述')" :disabled="saving" @keydown.enter.prevent="search()" /><button type="button" :disabled="saving || loading" @click="search()">{{ $t('搜索') }}</button></div><PagePagination :offset="offset" :next-offset="data?.nextOffset" :disabled="loading || saving" @change="search" /><label>{{ $t('关联事项') }}<select :aria-label="$t('关联事项')" v-model="form.issueId" required @change="choose" :disabled="loading || saving"><option value="" disabled>{{ $t('选择事项') }}</option><option v-if="selected && !data?.items.some(item => item.id === selected.id)" :value="selected.id">#{{ selected.number }} {{ selected.title }}</option><option v-for="issue in data?.items.filter(item => item.release?.status !== 'archived')" :key="issue.id" :value="issue.id">#{{ issue.number }} {{ issue.title }}</option></select></label><label>{{ $t('交付标题') }}<input v-model="form.title" required maxlength="200" :disabled="saving" /></label><MarkdownEditor v-model="form.body" :label="$t('交付说明')" :disabled="saving" :context-key="projectId + '/delivery'" /><label>{{ $t('提交标识（可选）') }}<input v-model="form.commit" maxlength="2000" :disabled="saving" /></label><label class="ui-check-row"><input v-model="form.share" type="checkbox" required :disabled="saving" /><span>{{ $t('我确认将以上交付说明与提交信息共享给有协作权限的项目成员。私人会话不会公开。') }}</span></label><div class="actions"><button class="primary" type="submit" :disabled="saving || !form.share || !form.body.trim() || !form.issueId">{{ saving ? $t('正在发布…') : $t('发布交付') }}</button><button type="button" :disabled="saving" @click="emit('close')">{{ $t('取消') }}</button></div></form></ModalDialog></template>
