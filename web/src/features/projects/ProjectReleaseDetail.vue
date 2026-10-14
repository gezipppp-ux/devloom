<script setup>
import { ArrowLeftOutlined, InboxOutlined } from "@antdv-next/icons";
import { formatDate } from "../../shared/i18n/index.js";
import PageHeader from "../../shared/components/PageHeader.vue";
import StatusBadge from "../../shared/components/StatusBadge.vue";
import ReleaseIssueScope from "./ReleaseIssueScope.vue";
const props = defineProps({ projectId: { type: String, required: true }, projectName: String, release: { type: Object, required: true }, canManage: Boolean, disabled: Boolean });
defineEmits(['back', 'edit', 'archive']);
const title = () => props.release.description?.split('\n')[0] || '';
</script>
<template>
  <section class="release-scope-page">
    <button class="issue-back" :disabled="disabled" @click="$emit('back')"><ArrowLeftOutlined aria-hidden="true" />{{ $t('返回版本') }}</button>
    <PageHeader :title="release.name + (title() ? ' · ' + title() : '')" :description="$t('目标交付 {date} · {project}', { date: release.targetDate ? formatDate(release.targetDate) : $t('暂无目标日期'), project: projectName || '' })" />
    <div class="release-detail-layout">
      <main class="release-detail-main"><ReleaseIssueScope :key="release.id" :project-id="projectId" :project-name="projectName" :release="release" /><div class="actions"><button :disabled="disabled" @click="$emit('back')">{{ $t('返回版本') }}</button></div><details v-if="release.description" class="release-full-description"><summary>{{ $t('版本说明') }}</summary><p class="release-description">{{ release.description }}</p></details></main>
      <aside class="release-detail-aside" :aria-label="$t('交付进展')">
        <h2>{{ $t('交付进展') }}</h2>
        <template v-if="release.progress"><p class="field-hint">{{ $t('已完成 / 全部事项') }}</p><p class="release-detail-count"><strong>{{ release.progress.completed }}</strong> / {{ release.progress.total }}</p><div v-if="release.progress.total" class="release-progress-track" role="progressbar" :aria-label="$t('版本完成进度')" :aria-valuemin="0" :aria-valuemax="release.progress.total" :aria-valuenow="release.progress.completed"><span :style="{ width: `${release.progress.completed / release.progress.total * 100}%` }" /></div><p v-if="release.progress.cancelled" class="field-hint">{{ $t('已取消 {count} 个事项', { count: release.progress.cancelled }) }}</p></template><p v-else class="muted">{{ $t('进度暂不可用') }}</p>
        <dl class="ui-meta-list"><dt>{{ $t('目标日期') }}</dt><dd>{{ release.targetDate ? formatDate(release.targetDate) : $t('暂无目标日期') }}</dd><dt>{{ $t('版本状态') }}</dt><dd><StatusBadge>{{ release.status === 'archived' ? $t('已归档') : $t('进行中') }}</StatusBadge></dd></dl>
        <div v-if="canManage" class="release-management-actions"><button v-if="release.status !== 'archived'" :disabled="disabled" @click="$emit('edit')">{{ $t('编辑版本') }}</button><button :disabled="disabled" @click="$emit('archive')"><InboxOutlined aria-hidden="true" />{{ release.status === 'archived' ? $t('恢复版本') : $t('归档版本') }}</button></div>
        <p class="release-note">{{ release.status === 'archived' ? $t('归档内容只读') : $t('归档要求所有事项已完成或取消，并且没有未结束开发任务。归档版本中的事项与任务只读。') }}</p>
      </aside>
    </div>
  </section>
</template>
