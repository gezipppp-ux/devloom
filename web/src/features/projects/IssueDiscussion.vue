<script setup>
import PublishDelivery from "./PublishDelivery.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { CommentOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import { readableTime } from "./project-records.js";
import ChangeRecord from "./ChangeRecord.vue";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
const props = defineProps({ endpoint: { type: String, required: true }, statusNames: { type: Object, default: () => ({}) }, deliverySubmission: { type: Object, default: null }, permissions: { type: Array, required: true }, prototypeLayout: Boolean });
const emit = defineEmits(["changed"]);
const publishing = ref(false);
const tab = ref(props.permissions.includes("collaboration.view") ? "comments" : "history"), offset = ref(0);
const drafts = reactive({ comments: { body: "" } });
const versions = { comments: 0 };
for (const key of Object.keys(drafts)) watch(drafts[key], () => { versions[key]++; }, { flush: "sync" });
const draft = computed(() => drafts[tab.value]);
const can = p => props.permissions.includes(p);
let permissionVersion = 0;
const { data, loading, saving, error, notice, reload, save } = useResource(async () => {
  const currentTab = tab.value;
  const page = await appApi(`${props.endpoint}/${currentTab}?offset=${offset.value}`);
  return page;
});
watch([() => can("collaboration.view"), () => can("comment.create"), () => can("deliverable.create"), () => can("session.view")], ([view, comments, deliverables]) => {
  permissionVersion++;
  if (!view || !comments) drafts.comments.body = "";
  if (!view || !deliverables) publishing.value = false;
  if (!view) tab.value = "history";
  data.value = null;
  offset.value = 0;
  void reload();
}, { flush: "sync" });
function change(value) { if (tab.value === value || value !== "history" && !can("collaboration.view")) return; tab.value = value; data.value = null; offset.value = 0; void reload(); }
function post() {
  if (tab.value !== "comments" || !can("collaboration.view") || !can("comment.create")) return;
  const submittedPermission = permissionVersion;
  const submittedTab = "comments", submitted = { ...drafts.comments }, version = versions.comments;
  const input = { body: submitted.body }, endpoint = props.endpoint + "/comments";
  return save(endpoint, input, () => {
    if (submittedPermission !== permissionVersion) { void reload(); return; }
    if (versions[submittedTab] === version) for (const key of Object.keys(submitted)) drafts[submittedTab][key] = "";
    void reload();
  });
}
</script>
<template><section class="project-section" :aria-label="$t('沟通与记录')"><h3 class="issue-panel-heading"><CommentOutlined aria-hidden="true" />{{ $t("沟通与记录") }}</h3><nav class="page-tabs" :aria-label="$t('事项记录')"><button v-if="can('collaboration.view')" :class="{ active: tab === 'comments' }" :aria-label="$t('评论')" @click="change('comments')">{{ prototypeLayout ? $t("讨论") : $t("评论") }}</button><button v-if="can('collaboration.view')" :class="{ active: tab === 'deliverables' }" :aria-label="$t('交付结果')" @click="change('deliverables')">{{ prototypeLayout ? $t("交付") : $t("交付结果") }}</button><button :class="{ active: tab === 'history' }" :aria-label="$t('变更历史')" @click="change('history')">{{ prototypeLayout ? $t("历史") : $t("变更历史") }}</button></nav><FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" /><p v-if="loading" role="status">{{ $t("正在读取记录…") }}</p><ol class="project-records"><li v-for="entry in data?.items" :key="entry.id"><PersonAvatar :name="data.people?.find(p => p.id === (entry.authorId || entry.actorId))?.displayName || $t('历史成员')" /><div class="issue-comment-body"><div class="issue-comment-meta"><strong>{{ data.people?.find(p => p.id === (entry.authorId || entry.actorId))?.displayName || $t("历史成员") }}</strong><small>{{ readableTime(entry.createdAt) }}</small></div><p class="project-text">{{ entry.body }}</p><p v-if="entry.commit">{{ $t("提交：") }}{{ entry.commit }}</p><RouterLink v-if="tab === 'deliverables'" :to="{ name: 'deliveries', query: { projectId: endpoint.split('/')[2], delivery: entry.id } }">{{ $t("查看交付与验收") }}</RouterLink><ChangeRecord v-if="tab === 'history'" :entry="entry" :people="data.people" :status-names="statusNames" /></div></li></ol><p v-if="data && !data.items.length" class="muted">{{ $t("暂无记录。") }}</p><div class="actions"><button v-if="offset" @click="offset = Math.max(0, offset - 30); reload()">{{ $t("上一页") }}</button><button v-if="data?.nextOffset != null" @click="offset = data.nextOffset; reload()">{{ $t("下一页") }}</button></div><form v-if="can('collaboration.view') && (tab === 'comments' && can('comment.create'))" class="project-form" @submit.prevent="post"><label><span :class="{ 'sr-only': prototypeLayout && tab === 'comments' }">{{ tab === 'comments' ? $t("评论内容") : $t("交付说明") }}</span><textarea v-model="draft.body" :placeholder="prototypeLayout && tab === 'comments' ? $t('补充想法，或提出一个问题…') : undefined" required rows="3" /></label><button type="submit" :class="prototypeLayout ? 'issue-comment-submit' : 'primary'" :aria-label="tab === 'comments' ? $t('发表评论') : $t('发布交付结果')" :disabled="saving || tab === 'deliverables' && !draft.reviewerId">{{ tab === 'comments' ? (prototypeLayout ? $t("发送讨论") : $t("发表评论")) : $t("发布交付结果") }}</button></form><button v-if="tab === 'deliverables' && can('deliverable.create') && deliverySubmission?.allowed" @click="publishing = true">{{ deliverySubmission.label }}</button><PublishDelivery v-if="publishing" :project-id="endpoint.split('/')[2]" :issue-id="endpoint.split('/issues/')[1]" @close="publishing = false" @published="publishing = false; reload(); emit('changed')" /></section></template>
