<script setup>
import ListFilters from "../../shared/components/ListFilters.vue";
import { useWorkListFilters } from "./use-work-list-filters.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import MergeDevelopmentDialog from "./MergeDevelopmentDialog.vue";
import DevelopmentTaskDetail from "./DevelopmentTaskDetail.vue";
import { useResource } from "../../shared/api/use-resource.js";
import WorkItemTable from "./WorkItemTable.vue";
import { workReturnLocation } from "./work-navigation.js";
const props = defineProps({
  projectId: { type: String, required: true },
  projectName: { type: String, default: "" },
  issueId: { type: String, default: "" },
  canContinue: Boolean,
  spaceReady: Boolean,
  workspaceId: { type: String, default: "" },
  canAssign: Boolean,
  readOnlyReason: { type: String, default: "" },
});
const emit = defineEmits(["open-workspace", "prepare-development"]);
const endpoint = `/projects/${props.projectId}/tasks`;
const route = useRoute(),
  router = useRouter();
const taskId = computed(() =>
  typeof route.query.task === "string" ? route.query.task : "",
);
const offset = computed(() =>
  Math.max(
    0,
    Number.parseInt(
      typeof route.query.taskOffset === "string" ? route.query.taskOffset : "",
      10,
    ) || 0,
  ),
);
const scope = computed(() =>
  props.issueId || route.query.taskScope === "all" ? "all" : "mine",
);
const selectedTasks = ref([]),
  merging = ref(false);
const { data, loading, error, reload } = useResource(() =>
  appApi(
    endpoint + "?" + new URLSearchParams({ offset: String(offset.value), scope: scope.value, ...filters.params.value, ...(props.issueId ? { issueId: props.issueId } : {}) }),
  ), { interval: 5000 },
);
const filters = useWorkListFilters("tasks", () => data.value?.filterOptions, { prefix: "task", defaultStatus: () => props.issueId ? "all" : "not_cancelled" });
watch([offset, scope, () => JSON.stringify(filters.params.value)], () => {
  selectedTasks.value = [];
  merging.value = false;
  void reload();
});
watch(taskId, () => {
  merging.value = false;
  selectedTasks.value = [];
});
const mergeTasks = computed(() =>
  (data.value?.tasks || []).filter((task) =>
    selectedTasks.value.includes(task.id),
  ),
);
const taskRows = computed(() => (data.value?.tasks || []).map(task => ({ ...task, selectionDisabled: !task.canMerge })));
const mergeError = computed(() => {
  const tasks = mergeTasks.value;
  if (tasks.length < 2)
    return "选择至少两个自己的待开发任务，可将需求和缺陷一起处理。";
  if (
    tasks.some(
      (task) => !task.canMerge || task.releaseId !== tasks[0].releaseId,
    )
  )
    return "请选择同一版本、尚未启动的本人任务。";
  if (tasks.reduce((total, task) => total + task.issueIds.length, 0) > 20)
    return "合并后的任务最多包含 20 条事项。";
  return "";
});
function changeScope(value) {
  return router.push({
    query: { ...route.query, taskScope: value, taskOffset: undefined },
  });
}
function open(task) {
  return router.push({
    query: { ...route.query, tab: "tasks", issue: undefined, task: task.id, taskStart: undefined },
  });
}
function back() {
  const target = workReturnLocation(router, route, "tasks");
  if (target) return router.push(target.fullPath);
  const query = { ...route.query };
  delete query.task;
  delete query.taskStart;
  delete query.returnTo;
  return router.push({ query });
}
function page(nextOffset) {
  return router.push({
    query: { ...route.query, taskOffset: nextOffset || undefined },
  });
}
function refresh() {
  selectedTasks.value = [];
  merging.value = false;
  return reload();
}
</script>
<template>
  <DevelopmentTaskDetail
    v-if="taskId"
    :key="`${projectId}/${taskId}`"
    :project-id="projectId"
    :task-id="taskId"
    :project-name="projectName"
    :space-ready="spaceReady"
    :workspace-id="workspaceId"
    :can-assign="canAssign"
    :can-continue="canContinue"
    :read-only-reason="readOnlyReason"
    @back="back"
    @changed="reload"
    @open-task="open"
    @prepare-development="(task) => emit('prepare-development', task)"
    @open-workspace="(id, key) => emit('open-workspace', id, key)"
  />
  <section v-else class="development-task-list">
    <MergeDevelopmentDialog
      v-if="merging"
      :project-id="projectId"
      :tasks="mergeTasks"
      @closed="merging = false"
      @merged="
        (task) => {
          merging = false;
          selectedTasks = [];
          open(task);
          reload();
        }
      "
    />
    <header class="project-heading">
      <h2>{{ issueId ? $t("关联开发任务") : $t("开发任务") }}</h2>
      <button :disabled="loading" @click="refresh">{{ $t("刷新任务") }}</button>
    </header>
    <FeedbackMessage :message="error" type="error" />
    <p v-if="loading && !data" role="status">{{ $t("正在读取开发任务…") }}</p>
    <nav v-if="!issueId" class="ui-segmented development-list-scopes" :aria-label="$t('开发任务范围')">
      <button
        :class="{ active: scope === 'mine' }"
        :aria-pressed="scope === 'mine'"
        @click="changeScope('mine')"
      >
        {{ $t("我的开发任务") }}</button
      ><button
        :class="{ active: scope === 'all' }"
        :aria-pressed="scope === 'all'"
        @click="changeScope('all')"
      >
        {{ $t("项目全部任务") }}
      </button>
    </nav>
    <ListFilters :fields="filters.fields.value" :model-value="filters.model.value" @update:model-value="filters.update" @reset="filters.reset" />
    <div v-if="!issueId && !readOnlyReason && selectedTasks.length" class="project-development-action ui-selection-bar">
      <button
        class="primary"
        :disabled="loading || Boolean(mergeError)"
        @click="merging = true"
      >
        {{ $t("合并所选任务（") }}{{ selectedTasks.length }}）</button
      ><span class="field-hint">{{
        mergeError || $t("所选任务将共用一个 Codex 会话，合并后再开始开发。")
      }}</span>
    </div>
    <WorkItemTable v-if="taskRows.length" v-model:selected="selectedTasks" :items="taskRows" :people="data?.filterOptions?.people || []" kind="tasks" :selectable="!issueId && !readOnlyReason" :disabled="loading" @open="open" @open-session="item => emit('open-workspace', item.workspaceId, item.runKey)">
      <template #details="{ item }"><p>{{ item.baseBranch || $t('基线未记录') }}</p></template>
    </WorkItemTable>
    <p v-if="data && !data.tasks.length" class="muted">
      {{
        scope === "mine"
          ? $t("暂无我的开发任务，请先认领需求或缺陷，或由项目成员指派给你。")
          : $t("暂无开发任务。")
      }}
    </p>
    <div class="actions">
      <button v-if="offset" @click="page(Math.max(0, offset - 30))">
        {{ $t("上一页") }}</button
      ><button v-if="data?.nextOffset != null" @click="page(data.nextOffset)">
        {{ $t("下一页") }}
      </button>
    </div>
    <p class="development-list-note field-hint">{{ $t('认领与合并不会启动执行') }}</p>
  </section>
</template>

<style scoped>
.development-status-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 16px 0; }
</style>
