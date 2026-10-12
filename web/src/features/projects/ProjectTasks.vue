<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { appApi, statusLabel } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";
const props = defineProps({ projectId: { type: String, required: true }, issueId: { type: String, default: "" }, canContinue: Boolean });
const emit = defineEmits(["open-workspace"]);
const endpoint = `/projects/${props.projectId}/tasks`;
const route = useRoute(), router = useRouter();
const taskId = computed(() => typeof route.query.task === "string" ? route.query.task : "");
const offset = computed(() => Math.max(0, Number.parseInt(typeof route.query.taskOffset === "string" ? route.query.taskOffset : "", 10) || 0));
const choices = ref([]), checked = ref([]), query = ref("");
const requestId = ref(createRequestId());
const { data, loading, saving, error, notice, reload, save, perform } = useResource(() => appApi(`${endpoint}?offset=${offset.value}${props.issueId ? `&issueId=${props.issueId}` : ""}`));
const detail = useResource(() => taskId.value ? appApi(`${endpoint}/${encodeURIComponent(taskId.value)}`) : null, { immediate: false });
const selected = computed(() => detail.data.value?.task?.id === taskId.value ? detail.data.value.task : null);
watch(taskId, () => { choices.value = []; checked.value = []; query.value = ""; void detail.reload(); }, { immediate: true });
watch(offset, () => { void reload(); });
const labels = { prepared: "已准备", dispatching: "启动请求已记录", started: "已启动", unknown: "执行结果待确认", failed: "启动失败" };
const additionLabels = { ready: "待发送", sending: "发送中", sent: "已发送", unknown: "发送结果待确认" };
function open(task) { return router.push({ query: { ...route.query, task: task.id } }); }
function back() { const query = { ...route.query }; delete query.task; return router.push({ query }); }
function page(nextOffset) { return router.push({ query: { ...route.query, taskOffset: nextOffset || undefined } }); }
function refresh() { return Promise.all([reload(), ...(taskId.value ? [detail.reload()] : [])]); }
function search() { return perform(() => appApi(`/projects/${props.projectId}/issues?query=${encodeURIComponent(query.value)}&limit=100`), result => { choices.value = result.items; }, ""); }
function append() { if (detail.loading.value || !selected.value) return; const id = taskId.value; return save(`${endpoint}/${id}/issues`, { requestId: requestId.value, issueIds: checked.value, send: false }, result => { if (taskId.value !== id) return; detail.data.value = result; checked.value = []; requestId.value = createRequestId(); void reload(); }, "追加快照已保存，点击发送才会继续会话。"); }
function send(batch) { if (detail.loading.value || !selected.value) return; const id = taskId.value; return save(`${endpoint}/${id}/additions/${batch.requestId}/continue`, {}, result => { if (taskId.value === id) detail.data.value = result; }, "追加资料已发送。"); }
</script>
<template><section class="project-section"><header class="project-heading"><h2>开发任务</h2><button :disabled="loading || detail.loading.value || saving" @click="refresh">刷新任务</button></header><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="success" role="status">{{ notice }}</p><p v-if="loading" role="status">正在读取开发任务…</p>
  <p v-if="selected && detail.error.value" class="error" role="alert">{{ detail.error.value }}</p><article v-if="selected" class="project-detail"><div class="actions"><button :disabled="saving" @click="back">返回任务列表</button><button v-if="selected.canOpenSession && selected.runKey" class="primary" @click="emit('open-workspace', selected.workspaceId, selected.runKey)">打开我的会话</button></div><h3>{{ selected.title }}</h3><p>{{ labels[selected.status] || selected.status }} · {{ statusLabel(selected.execution?.status) }}</p><p v-if="selected.error" class="error">{{ selected.error }}</p><details><summary>启动时的事项快照</summary><section v-for="issue in selected.issues" :key="issue.id"><h4>#{{ issue.number }} {{ issue.title }}</h4><p class="project-text">{{ issue.description }}</p><p class="project-text">{{ issue.acceptanceCriteria || issue.reproductionSteps }}</p></section></details><section v-for="batch in selected.additions" :key="batch.requestId" class="project-section"><h4>追加资料 · {{ additionLabels[batch.status] }}</h4><p v-for="issue in batch.issues" :key="issue.id">#{{ issue.number }} {{ issue.title }}</p><p v-if="batch.error" class="error">{{ batch.error }}</p><button v-if="batch.status === 'ready' && canContinue && selected.canOpenSession" :disabled="saving || detail.loading.value" @click="send(batch)">发送追加资料并继续会话</button></section>
    <section v-if="canContinue && selected.canOpenSession && selected.status === 'started'" class="project-section"><h3>追加项目事项</h3><form class="project-filter" @submit.prevent="search"><input v-model="query" aria-label="搜索追加事项" placeholder="搜索待追加的事项" /><button :disabled="saving">搜索事项</button></form><label v-for="issue in choices" :key="issue.id" class="permission-choice"><input v-model="checked" type="checkbox" :value="issue.id" :disabled="saving" />#{{ issue.number }} {{ issue.title }}</label><div class="actions"><button :disabled="saving || detail.loading.value || !checked.length" @click="append">保存追加快照</button></div></section>
  </article>
  <template v-else-if="taskId"><p v-if="detail.loading.value" role="status">正在读取指定开发任务…</p><p v-else class="error" role="alert">{{ detail.error.value || "指定开发任务不存在或无权访问。" }}</p><button @click="back">返回任务列表</button></template><template v-else><ul class="project-issue-list"><li v-for="task in data?.tasks" :key="task.id"><button class="project-issue-link" :disabled="saving" @click="open(task)"><span>{{ labels[task.status] || task.status }}</span><strong>{{ task.title }}</strong><small>{{ task.canOpenSession ? '我的开发任务' : '项目开发任务' }}</small></button></li></ul><p v-if="data && !data.tasks.length" class="muted">暂无关联开发任务。</p><div class="actions"><button v-if="offset" @click="page(Math.max(0, offset - 30))">上一页</button><button v-if="data?.nextOffset != null" @click="page(data.nextOffset)">下一页</button></div></template>
</section></template>
