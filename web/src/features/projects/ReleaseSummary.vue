<script setup>
import { formatDate } from "../../shared/i18n/index.js";
defineProps({ release: { type: Object, required: true } });
</script>
<template>
  <div class="release-row">
    <div class="release-number"><h3>{{ release.name }}</h3><span v-if="release.status === 'archived'" class="release-status release-status-archived">{{ $t("已归档") }}</span></div>
    <div class="release-row-main"><p class="release-row-description">{{ release.description?.split('\n')[0] || $t("暂无版本说明") }}</p><p class="release-row-meta">{{ $t("目标日期") }} · {{ release.targetDate ? formatDate(release.targetDate) : $t("暂无目标日期") }}</p></div>
    <div class="release-progress">
      <template v-if="release.progress">
        <p>{{ $t('{completed} / {total} 已完成', { completed: release.progress.completed, total: release.progress.total }) }}</p>
        <div v-if="release.progress.total" class="release-progress-track" role="progressbar" :aria-label="$t('版本完成进度')" :aria-valuemin="0" :aria-valuemax="release.progress.total" :aria-valuenow="release.progress.completed"><span :style="{ width: `${release.progress.completed / release.progress.total * 100}%` }" /></div>
        <p v-if="release.progress.cancelled" class="field-hint">{{ $t('已取消 {count} 个事项', { count: release.progress.cancelled }) }}</p>
      </template>
      <span v-else class="muted">{{ $t("进度暂不可用") }}</span>
    </div>
    <slot />
  </div>
</template>
