<script setup>
import { useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import PageHeader from "../../shared/components/PageHeader.vue";
import EmptyState from "../../shared/components/EmptyState.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import WorkActionList from "./WorkActionList.vue";
const props = defineProps({ projectId: { type: String, default: "" }, projects: { type: Array, default: () => [] } });
defineEmits(["create"]);
const router = useRouter();
const recent = useResource(() => appApi('/workbench/recent-projects'), { interval: 30000 });
const sections = [{ bucket: 'todo', title: '待推进', description: '当前需要你采取行动的工作' }, { bucket: 'doing', title: '处理中', description: '你已开始且仍在进行的工作' }, { bucket: 'verify', title: '待验证', description: '明确分派给你的测试与验收，包含验证中的工作' }];
const { data, loading, error, reload } = useResource(async () => Object.fromEntries(await Promise.all(sections.map(async section => [section.bucket, await appApi('/workbench/actions?' + new URLSearchParams({ bucket: section.bucket, limit: '5', ...(props.projectId ? { projectId: props.projectId } : {}) }))]))), { interval: 30000 });
</script>
<template><section class="page-layout workbench-home"><PageHeader :title="$t('工作台')" :description="$t('查看轮到你推进、处理和验证的工作。')"><button class="primary" @click="$emit('create')">{{ $t('新建事项') }}</button></PageHeader><FeedbackMessage :message="error || recent.error.value" type="error" /><button v-if="error" @click="reload">{{ $t('重新加载') }}</button><p v-if="loading && !data">{{ $t('正在读取工作内容…') }}</p><div v-if="data" class="ui-home-layout"><div class="ui-home-stream"><section v-for="section in sections" :key="section.bucket" class="ui-home-section"><header><div><h2>{{ $t(section.title) }} <span class="muted">{{ data[section.bucket].total }}</span></h2><p class="field-hint">{{ $t(section.description) }}</p></div><button @click="router.push({ name: 'work', query: { bucket: section.bucket, ...(projectId ? { projectId } : {}) } })">{{ $t('查看全部') }} →</button></header><WorkActionList v-if="data[section.bucket].items.length" :items="data[section.bucket].items" /><EmptyState v-else :title="$t('当前没有分派给你的此类工作')" :description="$t('查看权限或关注关系不会自动生成个人待办。')" /></section></div><aside class="ui-home-aside"><h2>{{ $t("最近项目") }}</h2><RouterLink v-for="project in (recent.data.value?.projects || []).filter(project => !projectId || project.id === projectId)" :key="project.id" class="ui-project-shortcut" :to="{ name: 'project', params: { projectId: project.id } }"><span class="ui-project-monogram">{{ project.name.slice(0, 1) }}</span><span>{{ project.name }}<small class="muted">{{ project.status === 'archived' ? $t("已归档") : $t("进行中") }}</small></span></RouterLink><RouterLink v-if="!recent.loading.value && !recent.data.value?.projects?.length" :to="{ name: 'projects' }">{{ $t("进入项目目录") }}</RouterLink></aside></div></section></template>
