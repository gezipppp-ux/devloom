<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import ListFilters from "../../shared/components/ListFilters.vue";
import { useWorkListFilters } from "./use-work-list-filters.js";
import { computed, ref, watch } from "vue";
import { formatNumber } from "../../shared/i18n/index.js";
import { useRoute, useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import PageHeader from "../../shared/components/PageHeader.vue";
import { PlusOutlined, SearchOutlined, ClockCircleOutlined } from "@antdv-next/icons";
import WorkItemTable from "./WorkItemTable.vue";
import EmptyState from "../../shared/components/EmptyState.vue";
import PagePagination from "../../shared/components/PagePagination.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import DeliveryDetail from "./DeliveryDetail.vue";
import PublishDelivery from "./PublishDelivery.vue";
import { workLocation, workReturnLocation } from "./work-navigation.js";
import MergeDevelopmentDialog from "./MergeDevelopmentDialog.vue";
import ArchiveDevelopmentDialog from "./ArchiveDevelopmentDialog.vue";
import IssueCreateMenu from "./IssueCreateMenu.vue";
const props = defineProps({ kind: { type: String, required: true }, projectId: { type: String, default: "" }, canPublish: Boolean });
const emit = defineEmits(["create", "open-workspace"]);
const route = useRoute(), router = useRouter();
const query = ref(String(route.query.q || ""));
const publishing = ref(route.query.publish === "1");
const selected = ref([]), merging = ref(false);
const archiving = ref(null);
const scope = ref(String(route.query.scope || "all")), type = ref(String(route.query.type || "")), status = ref(String(route.query.status || (props.kind === "tasks" ? "not_cancelled" : "")));
const offset = computed(() => Math.max(0, Number.parseInt(route.query.offset, 10) || 0));
const headings = { issues: ["事项", "从清晰的表达开始，一起把问题推进到完成。"], tasks: ["开发", "继续已有任务，或开始新的开发。"], deliveries: ["交付", "把完成的工作，变成可验证的结果。"] };
const { data, loading, error, reload } = useResource(() => {
  const params = new URLSearchParams({ query: String(route.query.q || ""), scope: String(route.query.scope || "all"), type: String(route.query.type || ""), status: String(route.query.status || ""), ...filters.params.value, offset: String(offset.value), ...(props.projectId ? { projectId: props.projectId } : {}) });
  return appApi(`/workbench/${props.kind}?${params}`);
});
const filters = useWorkListFilters(() => props.kind, () => data.value?.filterOptions);
watch(() => route.fullPath, () => { selected.value = []; merging.value = false; archiving.value = null; query.value = String(route.query.q || ""); scope.value = String(route.query.scope || "all"); type.value = String(route.query.type || ""); status.value = String(route.query.status || (props.kind === "tasks" ? "not_cancelled" : "")); void reload(); });
const rows = computed(() => (data.value?.items || []).map(item => ({ ...item, selectionDisabled: !item.canMerge && !item.canArchive })));
watch(rows, items => { selected.value = selected.value.filter(id => items.some(item => item.id === id && !item.selectionDisabled)); });
const mergeTasks = computed(() => rows.value.filter(item => selected.value.includes(item.id)));
const archiveError = computed(() => mergeTasks.value.some(task => !task.canArchive) ? "请选择有会话且有权归档的本人任务。" : "");
function archived(ids) {
  selected.value = selected.value.filter(id => !ids.includes(id));
  if (data.value) data.value = { ...data.value, items: data.value.items.filter(item => !ids.includes(item.id)), total: Math.max(0, data.value.total - ids.length) };
  void reload();
}
const mergeError = computed(() => {
  const tasks = mergeTasks.value;
  if (tasks.length < 2) return "选择至少两个自己的待开发任务，可将需求和缺陷一起处理。";
  if (tasks.some(task => !task.canMerge || task.projectId !== tasks[0].projectId || task.releaseId !== tasks[0].releaseId)) return "请选择同一项目、同一版本、尚未启动的本人任务。";
  if (tasks.reduce((count, task) => count + task.issueIds.length, 0) > 20) return "合并后的任务最多包含 20 条事项。";
  return "";
});
function search() { void router.push({ query: { ...route.query, q: query.value || undefined, scope: scope.value, type: type.value || undefined, status: status.value || undefined, offset: undefined } }); }
function backFromDelivery() { const target = workReturnLocation(router, route, "deliveries"); return router.push(target ? target.fullPath : { query: { ...route.query, delivery: undefined, returnTo: undefined } }); }
</script>
<template>
  <section class="page-layout work-queue">
    <ArchiveDevelopmentDialog v-if="archiving" :tasks="archiving" @closed="archiving = null" @archived="archived" />
    <MergeDevelopmentDialog v-if="merging && mergeTasks.length" :project-id="mergeTasks[0].projectId" :tasks="mergeTasks" @closed="merging = false" @merged="item => { merging = false; selected = []; router.push(workLocation('tasks', item, route.fullPath)); }" />
    <PublishDelivery v-if="publishing && canPublish && projectId" :project-id="projectId" @close="publishing = false" @published="delivery => { publishing = false; router.push({ name: 'deliveries', query: { projectId, delivery: delivery.id } }); }" />
    <DeliveryDetail v-if="kind === 'deliveries' && route.query.delivery && projectId" :key="String(route.query.delivery)" :project-id="projectId" :delivery-id="String(route.query.delivery)" @back="backFromDelivery" />
    <template v-else>
      <PageHeader :title="$t(headings[kind][0])" :description="$t(headings[kind][1])">
        <IssueCreateMenu v-if="kind === 'issues'" @create="emit('create', $event)" />
        <button v-else-if="kind === 'deliveries' && canPublish" class="primary" @click="publishing = true"><PlusOutlined aria-hidden="true" />{{ $t('发布交付') }}</button>
      </PageHeader>
      <div v-if="kind === 'tasks'" class="development-entry"><div><button class="primary" @click="emit('create', 'manual')"><PlusOutlined aria-hidden="true" />{{ $t('独立开发') }}</button><p class="field-hint">{{ $t('无需关联需求或 Bug。') }}</p></div><button @click="router.push({ name: 'issues', query: projectId ? { projectId } : {} })">{{ $t('从事项开发') }}</button></div>
      <form class="ui-list-toolbar" role="search" @submit.prevent="search">
        <div v-if="kind === 'issues'" class="ui-segmented" :aria-label="$t('事项类型')"><button v-for="option in [['', '全部'], ['requirement', '需求'], ['bug', '缺陷']]" :key="option[0]" type="button" :aria-pressed="type === option[0]" @click="type = option[0]; search()">{{ $t(option[1]) }}</button></div>
        <div v-else-if="kind === 'deliveries'" class="ui-segmented" :aria-label="$t('验收状态')"><button v-for="option in [['', '全部'], ['pending', '待验证'], ['accepted', '已通过'], ['returned', '已退回']]" :key="option[0]" type="button" :aria-pressed="status === option[0]" @click="status = option[0]; search()">{{ $t(option[1]) }}</button></div>
        <div v-else class="ui-segmented"><button type="button" aria-pressed="true">{{ $t('我的任务') }}</button><RouterLink v-if="projectId" :to="{ name: 'project', params: { projectId }, query: { tab: 'tasks', taskScope: 'all' } }">{{ $t('项目全部任务') }}</RouterLink><button v-else type="button" disabled :title="$t('请先在顶部选择具体项目')">{{ $t('项目全部任务') }}</button></div>
        <span class="ui-toolbar-spacer" /><label class="ui-compact-search"><button type="submit" :disabled="loading" :aria-label="$t('搜索')"><SearchOutlined aria-hidden="true" /></button><input v-model="query" type="search" :aria-label="$t('搜索')" :placeholder="$t(kind === 'issues' ? '搜索事项' : kind === 'tasks' ? '搜索开发任务' : '搜索交付')" @change="search" /></label><button v-if="kind === 'tasks'" type="button" class="development-quiet-button" @click="emit('create', 'history')"><ClockCircleOutlined aria-hidden="true" />{{ $t('查看已归档会话') }}</button>
      </form>
      <ListFilters :fields="filters.fields.value" :model-value="filters.model.value" @update:model-value="filters.update" @reset="filters.reset"><label v-if="kind !== 'tasks'" class="list-scope-filter">{{ $t('工作范围') }}<AppSelect native-events v-model="scope" :aria-label="$t('工作范围')" @change="search"><option value="all">{{ $t('全部') }}</option><option value="mine">{{ $t('与我有关') }}</option></AppSelect></label></ListFilters>
      <FeedbackMessage :message="error" type="error" /><button v-if="error" @click="reload">{{ $t('重试') }}</button><p v-if="loading" role="status">{{ $t('正在加载…') }}</p>
      <div v-if="kind === 'tasks' && selected.length" class="ui-selection-bar project-development-action"><span>{{ $t('已选择 {count} 个任务', { count: formatNumber(selected.length) }) }}</span><button class="primary" :disabled="loading || Boolean(archiveError)" :title="$t(archiveError)" @click="archiving = [...mergeTasks]">{{ $t('归档所选会话') }}</button><button :disabled="loading || Boolean(mergeError)" :title="$t(mergeError)" @click="merging = true">{{ $t('合并所选任务（') }}{{ selected.length }}）</button><button :disabled="loading" @click="selected = []">{{ $t('取消选择') }}</button><span class="field-hint">{{ $t(archiveError || '归档会话保留历史和代码，不改变开发任务状态。') }}</span></div>
      <template v-if="data?.items.length"><WorkItemTable v-model:selected="selected" :items="rows" :people="data.people" :kind="kind" :selectable="kind === 'tasks'" :personal="kind === 'tasks'" :disabled="loading" @open="item => router.push(workLocation(kind, item, route.fullPath))" @open-session="item => emit('open-workspace', item.workspaceId, item.runKey)" /></template>
      <EmptyState v-else-if="data && !loading" :title="$t('暂无符合条件的内容')" :description="$t('试试调整筛选，或从项目中开始新的工作。')" />
      <div v-if="kind === 'tasks'" class="development-list-footer">
        <span v-if="data" class="field-hint">{{ $t('共 {count} 个任务', { count: formatNumber(data.total) }) }}</span>
        <p class="field-hint">{{ $t('认领与合并不会启动执行') }}</p>
        <PagePagination v-if="offset || data?.nextOffset != null" :offset="offset" :next-offset="data?.nextOffset" :disabled="loading" @change="value => router.push({ query: { ...route.query, offset: value || undefined } })" />
      </div>
      <PagePagination v-else :offset="offset" :total="data?.total" :next-offset="data?.nextOffset" :disabled="loading" @change="value => router.push({ query: { ...route.query, offset: value || undefined } })" />
    </template>
  </section>
</template>

<style scoped>
.list-scope-filter { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
.list-scope-filter :deep(.app-select) { min-width: 120px; }
.development-entry { display: flex; align-items: flex-start; gap: 16px; margin: 4px 0 36px; }
.development-entry button { min-width: 176px; min-height: 46px; }
.development-entry p { margin: 8px 0 0; }
.development-status-tabs { margin-bottom: 12px; }
@media(max-width: 480px) { .development-entry { gap: 12px; } .development-entry > * { flex: 1; min-width: 0; } .development-entry button { width: 100%; min-width: 0; padding-inline: 12px; } }
</style>
