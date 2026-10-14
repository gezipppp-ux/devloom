<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { CommentOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import { readableTime } from "./project-records.js";
import ChangeRecord from "./ChangeRecord.vue";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
const props = defineProps({ endpoint: { type: String, required: true }, statusNames: { type: Object, default: () => ({}) }, permissions: { type: Array, required: true }, prototypeLayout: Boolean });
const tab = ref(props.permissions.includes("collaboration.view") ? "comments" : "history"), offset = ref(0);
const drafts = reactive({ comments: { body: "" }, deliverables: { body: "", commit: "", taskId: "", reviewerId: "" } });
const versions = { comments: 0, deliverables: 0 };
for (const key of Object.keys(drafts)) watch(drafts[key], () => { versions[key]++; }, { flush: "sync" });
const draft = computed(() => drafts[tab.value]);
const can = p => props.permissions.includes(p);
let permissionVersion = 0;
const { data, loading, saving, error, notice, reload, save } = useResource(async () => {
  const currentTab = tab.value;
  const page = await appApi(`${props.endpoint}/${currentTab}?offset=${offset.value}`);
  if (currentTab === "deliverables" && can("deliverable.create")) page.reviewers = (await appApi(`${props.endpoint.split('/issues/')[0]}/reviewers`)).items;
  if (currentTab === "deliverables" && can("session.view")) page.tasks = (await appApi(`${props.endpoint.split('/issues/')[0]}/tasks?scope=mine&limit=100`)).tasks;
  return page;
});
watch([() => can("collaboration.view"), () => can("comment.create"), () => can("deliverable.create"), () => can("session.view")], ([view, comments, deliverables, sessions]) => {
  permissionVersion++;
  if (!view || !comments) drafts.comments.body = "";
  if (!view || !deliverables) Object.assign(drafts.deliverables, { body: "", commit: "", taskId: "", reviewerId: "" });
  if (!sessions) drafts.deliverables.taskId = "";
  if (!view) tab.value = "history";
  data.value = null;
  offset.value = 0;
  void reload();
}, { flush: "sync" });
function change(value) { if (tab.value === value || value !== "history" && !can("collaboration.view")) return; tab.value = value; data.value = null; offset.value = 0; void reload(); }
function post() {
  if (!can("collaboration.view") || !can(tab.value === "comments" ? "comment.create" : "deliverable.create")) return;
  const submittedPermission = permissionVersion;
  const submittedTab = tab.value, submitted = { ...drafts[submittedTab] }, version = versions[submittedTab];
  const input = { body: submitted.body, ...(submittedTab === "deliverables" ? { ...(submitted.commit ? { commit: submitted.commit } : {}), ...(submitted.taskId ? { taskId: submitted.taskId } : {}) } : {}) };
  const endpoint = submittedTab === "deliverables" ? `${props.endpoint.split("/issues/")[0]}/deliveries` : `${props.endpoint}/${submittedTab}`;
  if (submittedTab === "deliverables") { input.issueId = props.endpoint.split("/issues/")[1]; input.reviewerId = submitted.reviewerId; }
  return save(endpoint, input, () => {
    if (submittedPermission !== permissionVersion) { void reload(); return; }
    if (versions[submittedTab] === version) for (const key of Object.keys(submitted)) drafts[submittedTab][key] = "";
    void reload();
  });
}
</script>
<template><section class="project-section" :aria-label="$t('沟通与记录')"><h3 class="issue-panel-heading"><CommentOutlined aria-hidden="true" />{{ $t("沟通与记录") }}</h3><nav class="page-tabs" :aria-label="$t('事项记录')"><button v-if="can('collaboration.view')" :class="{ active: tab === 'comments' }" :aria-label="$t('评论')" @click="change('comments')">{{ prototypeLayout ? $t("讨论") : $t("评论") }}</button><button v-if="can('collaboration.view')" :class="{ active: tab === 'deliverables' }" :aria-label="$t('交付结果')" @click="change('deliverables')">{{ prototypeLayout ? $t("交付") : $t("交付结果") }}</button><button :class="{ active: tab === 'history' }" :aria-label="$t('变更历史')" @click="change('history')">{{ prototypeLayout ? $t("历史") : $t("变更历史") }}</button></nav><FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" /><p v-if="loading" role="status">{{ $t("正在读取记录…") }}</p><ol class="project-records"><li v-for="entry in data?.items" :key="entry.id"><PersonAvatar :name="data.people?.find(p => p.id === (entry.authorId || entry.actorId))?.displayName || $t('历史成员')" /><div class="issue-comment-body"><div class="issue-comment-meta"><strong>{{ data.people?.find(p => p.id === (entry.authorId || entry.actorId))?.displayName || $t("历史成员") }}</strong><small>{{ readableTime(entry.createdAt) }}</small></div><p class="project-text">{{ entry.body }}</p><p v-if="entry.commit">{{ $t("提交：") }}{{ entry.commit }}</p><RouterLink v-if="tab === 'deliverables'" :to="{ name: 'deliveries', query: { projectId: endpoint.split('/')[2], delivery: entry.id } }">{{ $t("查看交付与验收") }}</RouterLink><ChangeRecord v-if="tab === 'history'" :entry="entry" :people="data.people" :status-names="statusNames" /></div></li></ol><p v-if="data && !data.items.length" class="muted">{{ $t("暂无记录。") }}</p><div class="actions"><button v-if="offset" @click="offset = Math.max(0, offset - 30); reload()">{{ $t("上一页") }}</button><button v-if="data?.nextOffset != null" @click="offset = data.nextOffset; reload()">{{ $t("下一页") }}</button></div><form v-if="can('collaboration.view') && (tab === 'comments' && can('comment.create') || tab === 'deliverables' && can('deliverable.create'))" class="project-form" @submit.prevent="post"><label><span :class="{ 'sr-only': prototypeLayout && tab === 'comments' }">{{ tab === 'comments' ? $t("评论内容") : $t("交付说明") }}</span><textarea v-model="draft.body" :placeholder="prototypeLayout && tab === 'comments' ? $t('补充想法，或提出一个问题…') : undefined" required rows="3" /></label><template v-if="tab === 'deliverables'"><label>{{ $t("交付验证人") }}<AppSelect native-events v-model="draft.reviewerId" :aria-label="$t('交付验证人')" required :disabled="saving"><option value="" disabled>{{ $t("选择明确的验证人") }}</option><option v-for="person in data?.reviewers || []" :key="person.id" :value="person.id">{{ person.displayName }}</option></AppSelect></label><label v-if="can('session.view')">{{ $t("关联开发任务") }}<AppSelect native-events :aria-label="$t('关联开发任务')" v-model="draft.taskId"><option value="">{{ $t("不关联任务") }}</option><option v-for="task in data?.tasks?.filter(task => task.runKey && ['started', 'completed'].includes(task.status) && task.issueIds.includes(endpoint.split('/issues/')[1]))" :key="task.id" :value="task.id">{{ task.title }}</option></AppSelect></label><label>{{ $t("提交标识（可选）") }}<input v-model="draft.commit" /></label></template><button type="submit" :class="prototypeLayout ? 'issue-comment-submit' : 'primary'" :aria-label="tab === 'comments' ? $t('发表评论') : $t('发布交付结果')" :disabled="saving || tab === 'deliverables' && !draft.reviewerId">{{ tab === 'comments' ? (prototypeLayout ? $t("发送讨论") : $t("发表评论")) : $t("发布交付结果") }}</button></form></section></template>
