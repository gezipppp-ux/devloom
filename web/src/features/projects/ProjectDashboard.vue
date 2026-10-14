<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { ArrowRightOutlined, SettingOutlined, FileTextOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import { formatDate } from "../../shared/i18n/index.js";
import RelativeTime from "../../shared/components/RelativeTime.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
import EmptyState from "../../shared/components/EmptyState.vue";
import ReleaseSummary from "./ReleaseSummary.vue";
import WorkItemList from "./WorkItemList.vue";
import { workLocation } from "./work-navigation.js";
const props = defineProps({ project: { type: Object, required: true }, permissions: { type: Array, default: () => [] } });
const emit = defineEmits(["tab"]);
const router = useRouter();
const canRead = computed(() => props.permissions.includes("issue.view"));
const activity = useResource(() => canRead.value ? appApi(`/projects/${props.project.id}/activity`) : Promise.resolve({ items: [] }), { interval: 30000 });
const activityLabels = { created: '创建了事项', updated: '编辑了事项', transition: '流转了事项', 'delivery.published': '发布了交付', 'delivery.reviewed': '验收了交付' };
function openActivity(item) {
  const location = item.deliveryId ? { name: 'deliveries', query: { projectId: props.project.id, delivery: item.deliveryId } } : workLocation('issues', { ...item.issue, projectId: props.project.id });
  void router.push(location);
}
const { data, loading, error, reload } = useResource(async () => {
  if (!canRead.value) return {};
  const scope = `projectId=${encodeURIComponent(props.project.id)}`;
  const [recent, active, deliveries, releases] = await Promise.all([
    appApi(`/workbench/issues?${scope}&limit=3`), appApi(`/workbench/issues?${scope}&active=true&limit=1`),
    props.permissions.includes("collaboration.view") ? appApi(`/workbench/deliveries?${scope}&status=pending&limit=1`) : null,
    appApi(`/projects/${props.project.id}/releases`),
  ]);
  return { recent, active, deliveries, release: releases.items.find(item => item.status === "active") };
});
const count = value => Number.isInteger(value) ? String(value).padStart(2, "0") : "—";
</script>
<template>
  <div class="project-overview-grid">
    <div class="project-overview-main">
      <FeedbackMessage :message="error" type="error" /><button v-if="error" @click="reload">{{ $t('重试') }}</button>
      <div class="project-metrics" :aria-busy="loading"><div v-if="canRead"><span>{{ $t('进行中的事项') }}</span><strong>{{ count(data?.active?.total) }}</strong></div><div v-if="canRead && permissions.includes('collaboration.view')"><span>{{ $t('待验证') }}</span><button @click="emit('tab', 'deliveries')">{{ count(data?.deliveries?.total) }}</button></div><div><span>{{ $t('参与者') }}</span><button @click="emit('tab', 'members')">{{ count(project.memberCount) }}</button></div></div>
      <template v-if="canRead">
        <section class="ui-overview-section"><header><h2>{{ $t('当前版本') }}</h2><button class="ui-text-link" @click="emit('tab', 'releases')"><ArrowRightOutlined aria-hidden="true" />{{ $t('查看版本') }}</button></header><ReleaseSummary v-if="data?.release" class="ui-release-summary" :release="data.release" /><EmptyState v-else-if="!loading && !error" :title="$t('暂无进行中的版本')" :description="$t('安排版本，让下一次交付更清晰。')" /><p v-else-if="loading" role="status">{{ $t('正在加载…') }}</p></section>
        <section class="ui-overview-section"><header><h2>{{ $t('近期事项') }}</h2><button class="ui-text-link" @click="router.push({ name: 'issues', query: { projectId: project.id } })"><ArrowRightOutlined aria-hidden="true" />{{ $t('全部事项') }}</button></header><WorkItemList v-if="data?.recent?.items.length" :items="data.recent.items" :people="data.recent.people" @open="item => router.push(workLocation('issues', item))" /><EmptyState v-else-if="!loading && !error" :title="$t('暂无事项')" :description="$t('从一个清晰的想法开始。')" /></section>
      </template>
    </div>
    <aside class="project-overview-aside"><section class="ui-detail-aside"><h2>{{ $t('项目概况') }}</h2><dl class="ui-meta-list"><dt>{{ $t('负责人') }}</dt><dd class="ui-person"><PersonAvatar :name="project.owner?.displayName" />{{ project.owner?.displayName || $t('未提供') }}</dd><dt>{{ $t('代码仓库') }}</dt><dd>{{ project.remoteUrl }}</dd><dt>{{ $t('参与者') }}</dt><dd class="ui-avatar-stack"><PersonAvatar v-for="(person, index) in project.memberPreview" :key="person.id" :name="person.displayName" :tone="index" /><span v-if="project.memberCount > 3" class="muted">+{{ project.memberCount - 3 }}</span></dd><dt>{{ $t('创建时间') }}</dt><dd>{{ formatDate(project.createdAt) }}</dd></dl><button v-if="permissions.includes('project.configure') && project.status !== 'archived'" class="ui-text-link" @click="emit('tab', 'settings')"><SettingOutlined aria-hidden="true" />{{ $t('项目配置') }}</button></section><section v-if="canRead" class="ui-overview-section"><h3>{{ $t('项目动态') }}</h3><FeedbackMessage :message="activity.error.value" type="error" /><button v-if="activity.error.value" @click="activity.reload">{{ $t('重试') }}</button><p v-if="activity.loading.value && !activity.data.value" role="status">{{ $t('正在加载…') }}</p><div v-if="activity.data.value?.items.length" class="ui-activity-list"><div v-for="item in activity.data.value.items" :key="item.id"><span class="ui-activity-icon"><FileTextOutlined aria-hidden="true" /></span><div><button class="ui-title-link" @click="openActivity(item)">{{ item.title || item.issue?.title }}</button><p>{{ item.actorName || $t('未提供') }} · {{ $t(activityLabels[item.action]) }}</p><p><RelativeTime :value="item.createdAt" /></p></div></div></div><p v-else-if="!activity.loading.value && !activity.error.value" class="muted">{{ $t('暂无项目动态') }}</p></section></aside>
  </div>
</template>
