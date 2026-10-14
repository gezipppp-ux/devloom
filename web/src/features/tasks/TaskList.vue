<script setup>
import { statusLabel } from "../../shared/api/api.js";
defineProps({ runs: { type: Array, default: () => [] }, active: { type: String, default: null }, unreadResultKeys: { type: Array, default: () => [] } });
const emit = defineEmits(["open"]);
</script>
<template>
  <nav class="task-list" :aria-label="$t('会话列表')">
    <button v-for="run in runs" :key="run.key" class="session-link" :class="{ active: active === run.key }" @click="emit('open', run.key)">
      <span class="session-title-row"><span class="session-title">{{ run.title }}</span><span v-if="unreadResultKeys.includes(run.key)" class="unread-result" role="img" :aria-label="$t('有未读 {p0} 回复', { p0: run.agent?.label || 'Agent' })" /></span>
      <span class="session-meta"><i :class="{ live: ['running', 'inProgress'].includes(run.status) }" />{{ run.agent?.label || 'Agent' }} · {{ $t(statusLabel(run.status || run.execution?.status)) }}</span>
    </button>
    <p v-if="!runs.length" class="muted">{{ $t('暂无会话，可从独立开发开始。') }}</p>
  </nav>
</template>
<style scoped>
.task-list { padding: 0; }
.session-link { padding: 16px; width: 100%; margin-bottom: 6px; border: 0; border-radius: 8px; background: transparent; text-align: left; }
.session-link.active { background: var(--selected); }
.session-title { font-weight: 500; line-height: 1.6; }
.session-meta { margin-top: 6px; font-size: 12px; }
</style>
