<script setup>
import { computed, reactive, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import { readableTime } from "./project-records.js";
import ChangeRecord from "./ChangeRecord.vue";
const props = defineProps({ endpoint: { type: String, required: true }, permissions: { type: Array, required: true } });
const tab = ref(props.permissions.includes("collaboration.view") ? "comments" : "history"), offset = ref(0);
const drafts = reactive({ comments: { body: "" }, deliverables: { body: "", commit: "", taskId: "" } });
const versions = { comments: 0, deliverables: 0 };
for (const key of Object.keys(drafts)) watch(drafts[key], () => { versions[key]++; }, { flush: "sync" });
const draft = computed(() => drafts[tab.value]);
const can = p => props.permissions.includes(p);
let permissionVersion = 0;
const { data, loading, saving, error, reload, save } = useResource(async () => {
  const currentTab = tab.value;
  const page = await appApi(`${props.endpoint}/${currentTab}?offset=${offset.value}`);
  if (currentTab === "deliverables" && can("session.view")) page.tasks = (await appApi(`${props.endpoint.split('/issues/')[0]}/tasks?limit=100`)).tasks;
  return page;
});
watch([() => can("collaboration.view"), () => can("comment.create"), () => can("deliverable.create"), () => can("session.view")], ([view, comments, deliverables, sessions]) => {
  permissionVersion++;
  if (!view || !comments) drafts.comments.body = "";
  if (!view || !deliverables) Object.assign(drafts.deliverables, { body: "", commit: "", taskId: "" });
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
  return save(`${props.endpoint}/${submittedTab}`, input, () => {
    if (submittedPermission !== permissionVersion) { void reload(); return; }
    if (versions[submittedTab] === version) for (const key of Object.keys(submitted)) drafts[submittedTab][key] = "";
    void reload();
  });
}
</script>
<template><section class="project-section"><nav class="project-tabs" aria-label="事项记录"><button v-if="can('collaboration.view')" :class="{ active: tab === 'comments' }" @click="change('comments')">评论</button><button v-if="can('collaboration.view')" :class="{ active: tab === 'deliverables' }" @click="change('deliverables')">交付结果</button><button :class="{ active: tab === 'history' }" @click="change('history')">变更历史</button></nav><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="loading" role="status">正在读取记录…</p><ol class="project-records"><li v-for="entry in data?.items" :key="entry.id"><small class="muted">{{ readableTime(entry.createdAt) }} · {{ data.people?.find(p => p.id === (entry.authorId || entry.actorId))?.username || '历史成员' }}</small><p class="project-text">{{ entry.body }}</p><p v-if="entry.commit">提交：{{ entry.commit }}</p><ChangeRecord v-if="tab === 'history'" :entry="entry" :people="data.people" /></li></ol><p v-if="data && !data.items.length" class="muted">暂无记录。</p><div class="actions"><button v-if="offset" @click="offset = Math.max(0, offset - 30); reload()">上一页</button><button v-if="data?.nextOffset != null" @click="offset = data.nextOffset; reload()">下一页</button></div><form v-if="can('collaboration.view') && (tab === 'comments' && can('comment.create') || tab === 'deliverables' && can('deliverable.create'))" class="project-form" @submit.prevent="post"><label>{{ tab === 'comments' ? '评论内容' : '交付说明' }}<textarea v-model="draft.body" required rows="3" /></label><template v-if="tab === 'deliverables'"><label v-if="can('session.view')">关联开发任务<select aria-label="关联开发任务" v-model="draft.taskId"><option value="">不关联任务</option><option v-for="task in data?.tasks" :key="task.id" :value="task.id">{{ task.title }}</option></select></label><label>提交标识（可选）<input v-model="draft.commit" /></label></template><button type="submit" class="primary" :disabled="saving">{{ tab === 'comments' ? '发表评论' : '发布交付结果' }}</button></form></section></template>
