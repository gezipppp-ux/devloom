<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, ref } from "vue";
import { statusLabel } from "../../shared/api/api.js";
import { accountSession, saveAccountSettings } from "../../shared/api/account-session.js";
import {
  FileTextOutlined,
  BugOutlined,
  InboxOutlined,
} from "@antdv-next/icons";
import {
  taskTypes,
  taskProgresses,
  taskTypeLabel,
  taskProgressLabel,
} from "./task-metadata.js";
const props = defineProps({
  runs: { type: Array, default: () => [] },
  active: { type: String, default: null },
  unreadResultKeys: { type: Array, default: () => [] },
});
const emit = defineEmits(["open"]);
const preferenceError = ref("");
const grouping = computed(() => accountSession.settings.grouping || "type");
async function changeGrouping(event) {
  preferenceError.value = "";
  try { await saveAccountSettings({ grouping: event.target.value }); }
  catch (error) { preferenceError.value = error.message; }
}
const groups = computed(() => {
  if (grouping.value === "none")
    return [{ value: "all", label: "全部任务", runs: props.runs }];
  const options = grouping.value === "type" ? taskTypes : taskProgresses;
  return options
    .map((entry) => ({
      ...entry,
      runs: props.runs.filter(
        (run) =>
          (run.metadata?.[grouping.value] ||
            (grouping.value === "type" ? "requirement" : "in_progress")) ===
          entry.value,
      ),
    }))
    .filter((group) => group.runs.length);
});
</script>

<template>
  <div class="task-list-toolbar">
    <span
      >{{ $t("需求列表") }} <small>{{ runs.length }}</small></span
    >
    <select :value="grouping" :aria-label="$t('任务分组方式')" @change="changeGrouping">
      <option value="type">{{ $t("按类型") }}</option>
      <option value="progress">{{ $t("按进度") }}</option>
      <option value="none">{{ $t("不分组") }}</option>
    </select>
  </div>
  <FeedbackMessage :message="preferenceError ? $t('分组保存失败：{p0}', { p0: preferenceError }) : ''" type="error" />
  <nav class="task-list" :aria-label="$t('会话列表')">
    <details
      v-for="group in groups"
      :key="`${grouping}:${group.value}`"
      class="task-group"
      :class="{ ungrouped: grouping === 'none' }"
      open
    >
      <summary :aria-label="$t('{p0}分组，{p1}个任务', { p0: group.label, p1: group.runs.length })">
        <span>{{ $t(group.label) }}</span
        ><small>{{ group.runs.length }}</small>
      </summary>
      <button
        v-for="run in group.runs"
        :key="run.key"
        class="session-link"
        :class="{ active: active === run.key }"
        @click="emit('open', run.key)"
      >
        <span class="session-title-row"
          ><component
            :is="
              run.metadata?.type === 'bug'
                ? BugOutlined
                : run.metadata?.type === 'other'
                  ? InboxOutlined
                  : FileTextOutlined
            "
            aria-hidden="true"
          /><span class="session-title">{{ run.title }}</span
          ><span
            v-if="props.unreadResultKeys.includes(run.key)"
            class="unread-result"
            role="img"
            :aria-label="$t('有未读 {p0} 回复', { p0: run.agent?.label || 'Agent' })"
          ></span></span
        >
        <span class="task-tags"
          ><span
            class="task-type-tag"
            :data-type="run.metadata?.type || 'requirement'"
            >{{ $t(taskTypeLabel(run.metadata?.type)) }}</span
          ><span
            class="task-progress-tag"
            :data-progress="run.metadata?.progress || 'in_progress'"
            >{{ $t(taskProgressLabel(run.metadata?.progress)) }}</span
          ></span
        >
        <span class="session-meta"
          ><i
            :class="{ live: ['running', 'inProgress'].includes(run.status) }"
          ></i
          >{{ run.agent?.label || 'Agent' }} · {{ $t(statusLabel(run.status || run.execution?.status)) }}</span
        >
        <small v-if="run.requirementCount > 1">{{ $t("关联") }} {{ run.requirementCount }} {{ $t("条需求") }}</small>
      </button>
    </details>
    <p v-if="!runs.length" class="muted">{{ $t("暂无任务，从一个需求开始。") }}</p>
  </nav>
</template>

<style scoped>
.task-list-toolbar { padding: 18px 16px 10px; font-size: 12px; color: var(--muted); }
.task-list-toolbar select { font-size: 12px; border-color: transparent; background: transparent; padding-inline: 4px; }
.task-list { padding: 0 8px 12px; }
.task-group summary { padding: 12px 8px; font-size: 12px; color: var(--muted); }
.session-link { margin-bottom: 4px; padding: 12px; border: 0; border-radius: 7px; background: transparent; box-shadow: none; }
.session-link.active { color: var(--ink); background: var(--selected); box-shadow: none; }
.session-title { line-height: 1.6; font-weight: 500; }
.session-meta { font-size: 12px; }
.task-tags { margin-top: 8px; gap: 6px; }
@media (max-width: 767px) { .session-link { min-height: 44px; } }
</style>
