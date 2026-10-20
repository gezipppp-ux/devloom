<script setup>
import { computed, reactive } from "vue";
import { CheckOutlined, ClockCircleOutlined, RightOutlined } from "@antdv-next/icons";
import { formatNumber } from "../../shared/i18n/index.js";
import { activitySummary, sessionRows } from "./session-activity.js";
import SessionItem from "./SessionItem.vue";

const props = defineProps({
  items: { type: Array, required: true },
  agentLabel: { type: String, default: "Agent" },
});
const emit = defineEmits(["open-file"]);
const expandedGroups = reactive(new Set());
const expandedItems = reactive(new Set());
const rows = computed(() => sessionRows(props.items).map(row => row.kind === "activity"
  ? { ...row, summary: activitySummary(row.items) } : row));
// Remember expansion by member identity so prepending history or a failure
// splitting a group does not discard the reader's choices. Session key remounts
// this component, isolating these sets from other conversations.
const isExpanded = row => row.items.some(item => expandedGroups.has(item.id));
function toggleGroup(row, open) {
  for (const item of row.items) {
    if (open) expandedGroups.add(item.id);
    else expandedGroups.delete(item.id);
  }
}
function toggleItem(id, open) {
  if (open) expandedItems.add(id);
  else expandedItems.delete(id);
}
</script>

<template>
  <template v-for="row in rows" :key="`${row.kind}:${row.id}`">
    <details v-if="row.kind === 'activity'" class="session-activity" :open="isExpanded(row)"
      @toggle="toggleGroup(row, $event.currentTarget.open)">
      <summary class="activity-summary">
        <span v-if="row.summary.active" class="activity-spinner" aria-hidden="true" />
        <CheckOutlined v-else-if="row.summary.completed" aria-hidden="true" />
        <ClockCircleOutlined v-else aria-hidden="true" />
        <span class="activity-label">{{ $t(row.summary.label) }}</span>
        <span class="activity-count">{{ $t('{count} 项活动', { count: formatNumber(row.items.length) }) }}</span>
        <RightOutlined class="activity-chevron" aria-hidden="true" />
      </summary>
      <div v-if="isExpanded(row)" class="activity-entries">
        <SessionItem v-for="item in row.items" :key="item.id" :item="item" compact
          :tool-open="expandedItems.has(item.id)" :agent-label="agentLabel"
          @tool-toggle="toggleItem(item.id, $event)" @open-file="emit('open-file', $event)" />
      </div>
    </details>
    <SessionItem v-else :item="row.item" :agent-label="agentLabel" :tool-open="expandedItems.has(row.item.id)"
      @tool-toggle="toggleItem(row.item.id, $event)" @open-file="emit('open-file', $event)" />
  </template>
</template>

<style scoped>
.session-activity { margin: 0 0 24px 43px; min-width: 0; color: var(--muted); font-size: 12px; }
.activity-summary { display: flex; align-items: center; gap: 8px; min-height: 32px; width: fit-content; max-width: 100%; padding: 3px 0; cursor: pointer; list-style: none; }
.activity-summary::-webkit-details-marker { display: none; }
.activity-summary:hover { color: var(--ink); }
.activity-summary > .anticon { font-size: 13px; flex-shrink: 0; }
.activity-label { min-width: 0; overflow-wrap: anywhere; }
.activity-count { color: var(--muted); white-space: nowrap; }
.activity-chevron { transition: transform .15s; font-size: 10px !important; }
.session-activity[open] > summary .activity-chevron { transform: rotate(90deg); }
.activity-spinner { display: inline-block; width: 13px; height: 13px; flex-shrink: 0; border: 1.5px solid var(--field-border); border-top-color: var(--muted); border-radius: 50%; animation: activity-spin 1.2s linear infinite; }
.activity-entries { margin: 8px 0 0 6px; padding: 0 0 0 16px; border-left: 1px solid var(--line); }
@keyframes activity-spin { to { transform: rotate(360deg); } }
@media (max-width: 767px) {
  .session-activity { margin-left: 0; margin-bottom: 20px; }
  .activity-summary { min-height: 44px; width: 100%; }
  .activity-chevron { margin-left: auto; }
  .activity-entries { padding-left: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .activity-spinner { animation: none; }
  .activity-chevron { transition: none; }
}
</style>
