<script setup>
import { computed } from "vue";
import { formatDate, translate } from "../../shared/i18n/index.js";
const props = defineProps({ issue: { type: Object, required: true } });
const assignment = computed(() => props.issue.developmentAssignment?.developerId === props.issue.developerId ? props.issue.developmentAssignment : null);
const person = id => props.issue.people?.find(item => item.id === id)?.displayName || translate("未知成员");
</script>
<template>
  <section class="issue-assignment" :aria-label="$t('开发分派')">
    <h3>{{ $t('开发分派') }}</h3>
    <template v-if="assignment">
      <p v-if="assignment.method === 'claimed'">{{ $t('{name}自行认领', { name: person(assignment.actorId) }) }}</p>
      <p v-else>{{ $t('{from} 指派给 {to}', { from: person(assignment.actorId), to: person(assignment.developerId) }) }}</p>
      <time :datetime="assignment.createdAt">{{ formatDate(assignment.createdAt, { hour: '2-digit', minute: '2-digit' }) }}</time>
    </template>
    <template v-else-if="issue.developerId"><p>{{ person(issue.developerId) }}</p><small>{{ $t('分派记录待确认') }}</small></template>
    <p v-else class="field-hint">{{ $t('尚未分派开发负责人') }}</p>
  </section>
</template>
<style scoped>
.issue-assignment { min-width: 0; padding: 16px; border-radius: 8px; background: var(--soft); }
.issue-assignment h3 { font-size: 12px; font-weight: 500; color: var(--muted); margin: 0 0 10px; }
.issue-assignment p { font-size: 13px; font-weight: 500; margin: 0; overflow-wrap: anywhere; line-height: 1.8; }
.issue-assignment time, .issue-assignment small { display: block; font-size: 12px; color: var(--muted); margin-top: 6px; }
</style>
