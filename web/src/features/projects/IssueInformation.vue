<script setup>
/* global window */
import { ref, onMounted, onUnmounted } from "vue";
import { formatDate, translate } from "../../shared/i18n/index.js";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
import { priorityLabels } from "./project-labels.js";
defineProps({ issue: { type: Object, required: true }, projectName: { type: String, default: "" } });
const media = window.matchMedia('(min-width: 1200px)');
const expanded = ref(media.matches);
const resize = event => { expanded.value = event.matches; };
onMounted(() => media.addEventListener('change', resize));
onUnmounted(() => media.removeEventListener('change', resize));
const person = (issue, id, missing = "未分派") => !id ? translate(missing) : issue.people?.find(item => item.id === id)?.displayName || translate("未知成员");
</script>
<template>
  <section class="issue-panel issue-information" :aria-label="$t('事项信息')">
    <details :open="expanded">
      <summary>{{ $t('事项信息') }}</summary>
      <dl class="context-facts">
        <template v-if="projectName"><dt>{{ $t('所属项目') }}</dt><dd>{{ projectName }}</dd></template>
        <dt>{{ $t('事项状态') }}</dt><dd>{{ issue.statusName || issue.status }}</dd>
        <dt>{{ $t('目标版本') }}</dt><dd><RouterLink v-if="issue.release" :to="{ path: `/projects/${issue.projectId}`, query: { tab: 'releases' } }">{{ issue.release.name }}</RouterLink><span v-else>{{ $t('未排期') }}</span></dd>
        <dt>{{ $t('优先级') }}</dt><dd>{{ $t(priorityLabels[issue.priority] || '未知') }}</dd>
        <template v-for="[key, label] in [['reporterId', '提报人'], ['businessOwnerId', '业务负责人'], ['developerId', '开发负责人'], ['qaOwnerId', '测试负责人'], ['acceptanceOwnerId', '业务验收人'], ['createdById', '创建者']]" :key="key">
          <dt>{{ $t(label) }}</dt><dd><span class="context-person"><PersonAvatar v-if="issue[key]" :name="person(issue, issue[key])" />{{ person(issue, issue[key], key === 'createdById' ? '未知成员' : '未分派') }}</span></dd>
        </template>
        <dt>{{ $t('关注人') }}</dt><dd class="context-watchers"><span v-for="id in issue.watcherIds" :key="id" class="context-person"><PersonAvatar :name="person(issue, id)" />{{ person(issue, id) }}</span><span v-if="!issue.watcherIds?.length">{{ $t('无') }}</span></dd>
        <template v-if="issue.type === 'bug'"><dt>{{ $t('严重程度') }}</dt><dd>{{ $t({minor:'轻微',normal:'普通',major:'严重',critical:'致命'}[issue.severity] || '未知') }}</dd></template>
        <template v-if="issue.dueDate"><dt>{{ $t('截止日期') }}</dt><dd>{{ formatDate(issue.dueDate) }}</dd></template>
      </dl>
      <div v-if="issue.tags?.length" class="ui-tags"><span v-for="tag in issue.tags" :key="tag">{{ tag }}</span></div>
    </details>
  </section>
</template>
<style scoped>
summary { cursor: pointer; font-size: 13px; font-weight: 600; }
.context-facts { display: grid; grid-template-columns: 90px minmax(0,1fr); gap: 14px 12px; margin: 20px 0 0; font-size: 13px; align-items: start; }
.context-facts dt { color: var(--muted); line-height: 1.8; }
.context-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; line-height: 1.8; }
.context-person { display: flex; align-items: flex-start; gap: 8px; overflow-wrap: anywhere; }
.context-person :deep(.ui-person-avatar) { flex-shrink: 0; }
.context-watchers { display: grid; gap: 8px; }
.ui-tags { margin-top: 16px; }
@media(max-width:767px) { summary { min-height: 44px; display: flex; align-items: center; } summary:before { content: '▸'; margin-right: 8px; } details[open]>summary:before { content: '▾'; } }
</style>
