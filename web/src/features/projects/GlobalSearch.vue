<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import FilterBar from "../../shared/components/FilterBar.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import EmptyState from "../../shared/components/EmptyState.vue";
import WorkItemList from "./WorkItemList.vue";
import { workLocation } from "./work-navigation.js";
const props = defineProps({ projects: { type: Array, default: () => [] } });
const emit = defineEmits(["close"]);
const router = useRouter(), query = ref("");
const groups = [{ kind: "issues", title: "事项" }, { kind: "tasks", title: "我的开发" }, { kind: "deliveries", title: "交付" }];
const { data, loading, error, reload } = useResource(async () => {
  const value = query.value.trim();
  if (!value) return null;
  return { projects: props.projects.filter(project => (project.name + ' ' + project.description).toLowerCase().includes(value.toLowerCase())).slice(0, 8), ...Object.fromEntries(await Promise.all(groups.map(async group => [group.kind, await appApi('/workbench/' + group.kind + '?query=' + encodeURIComponent(value) + '&limit=5')]))) };
}, { immediate: false });
function open(location) { emit('close'); void router.push(location); }
</script>
<template><ModalDialog open wide :title="$t(&quot;搜索项目与工作&quot;)" @close="emit('close')"><FilterBar v-model="query" :placeholder="$t(&quot;搜索项目、事项、任务或交付&quot;)" :busy="loading" @search="reload" /><FeedbackMessage :message="error" type="error" /><p v-if="loading" role="status">{{ $t("正在搜索…") }}</p><template v-if="data"><section v-if="data.projects.length" class="ui-search-group"><h3>{{ $t("项目") }}</h3><button v-for="project in data.projects" :key="project.id" class="ui-project-shortcut" @click="open({ name: 'project', params: { projectId: project.id } })">{{ project.name }} ↗</button></section><section v-for="group in groups" :key="group.kind" class="ui-search-group"><h3>{{ $t(group.title) }} <span class="muted">{{ data[group.kind].total }}</span></h3><WorkItemList :items="data[group.kind].items" :people="data[group.kind].people" :kind="group.kind" @open="item => open(workLocation(group.kind, item))" /><p v-if="!data[group.kind].items.length" class="muted">{{ $t("暂无匹配结果。") }}</p></section></template><EmptyState v-else-if="!loading" :title="$t(&quot;找到下一件事&quot;)" :description="$t(&quot;搜索你有权访问的项目内容，开发任务仅显示本人数据。&quot;)" /></ModalDialog></template>
