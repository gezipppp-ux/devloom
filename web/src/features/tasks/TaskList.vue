<script setup>
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
      >需求列表 <small>{{ runs.length }}</small></span
    >
    <select :value="grouping" aria-label="任务分组方式" @change="changeGrouping">
      <option value="type">按类型</option>
      <option value="progress">按进度</option>
      <option value="none">不分组</option>
    </select>
  </div>
  <p v-if="preferenceError" class="error" role="alert">分组保存失败：{{ preferenceError }}</p>
  <nav class="task-list" aria-label="会话列表">
    <details
      v-for="group in groups"
      :key="`${grouping}:${group.value}`"
      class="task-group"
      :class="{ ungrouped: grouping === 'none' }"
      open
    >
      <summary :aria-label="`${group.label}分组，${group.runs.length}个任务`">
        <span>{{ group.label }}</span
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
            :aria-label="`有未读 ${run.agent?.label || 'Agent'} 回复`"
          ></span></span
        >
        <span class="task-tags"
          ><span
            class="task-type-tag"
            :data-type="run.metadata?.type || 'requirement'"
            >{{ taskTypeLabel(run.metadata?.type) }}</span
          ><span
            class="task-progress-tag"
            :data-progress="run.metadata?.progress || 'in_progress'"
            >{{ taskProgressLabel(run.metadata?.progress) }}</span
          ></span
        >
        <span class="session-meta"
          ><i
            :class="{ live: ['running', 'inProgress'].includes(run.status) }"
          ></i
          >{{ run.agent?.label || 'Agent' }} · {{ statusLabel(run.status || run.execution?.status) }}</span
        >
        <small v-if="run.requirementCount > 1">关联 {{ run.requirementCount }} 条需求</small>
      </button>
    </details>
    <p v-if="!runs.length" class="muted">暂无任务，从一个需求开始。</p>
  </nav>
</template>
