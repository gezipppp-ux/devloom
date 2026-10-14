<script setup>
import { useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import PageHeader from "../../shared/components/PageHeader.vue";
import EmptyState from "../../shared/components/EmptyState.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import WorkItemList from "./WorkItemList.vue";
import { workLocation } from "./work-navigation.js";
const props = defineProps({ projectId: { type: String, default: "" }, projects: { type: Array, default: () => [] } });
const emit = defineEmits(["create"]);
const router = useRouter();
const sections = [{ kind: "issues", title: "待推进", route: "issues", query: "scope=mine&active=true" }, { kind: "tasks", title: "我的开发", route: "development", query: "active=true" }, { kind: "deliveries", title: "待验证", route: "deliveries", query: "status=pending" }];
const { data, loading, error, reload } = useResource(async () => Object.fromEntries(await Promise.all(sections.map(async section => {
  const selected = props.projects.find(p => p.id === props.projectId);
  const permission = section.kind === 'tasks' ? 'session.view' : section.kind === 'deliveries' ? 'collaboration.view' : 'issue.view';
  if (props.projectId && selected && !selected.permissions.includes(permission)) return [section.kind, { items: [], people: [], total: 0 }];
  return [section.kind, await appApi('/workbench/' + section.kind + '?limit=5&' + section.query + (props.projectId ? '&projectId=' + props.projectId : ''))];
}))), { interval: 30000 });
</script>
<template><section class="page-layout workbench-home"><PageHeader :title="$t(&quot;工作台&quot;)" :description="$t(&quot;从下一件事开始，让每一步都有进展。&quot;)"><button class="primary" @click="emit('create')">{{ $t("＋ 新建事项") }}</button></PageHeader><FeedbackMessage :message="error" type="error" /><button v-if="error" @click="reload">{{ $t("重新加载") }}</button><p v-if="loading && !data" role="status">{{ $t("正在读取工作内容…") }}</p><div v-if="data" class="ui-home-layout"><div class="ui-home-stream"><section v-for="section in sections" :key="section.kind" class="ui-home-section"><header><h2>{{ $t(section.title) }} <span class="muted">{{ data[section.kind].total }}</span></h2><RouterLink :to="{ name: section.route, query: { ...(projectId ? { projectId } : {}), ...(section.kind === 'issues' ? { scope: 'mine' } : section.kind === 'deliveries' ? { status: 'pending' } : {}) } }">{{ $t("查看全部 ↗") }}</RouterLink></header><WorkItemList v-if="data[section.kind].items.length" :items="data[section.kind].items" :people="data[section.kind].people" :kind="section.kind" @open="item => router.push(workLocation(section.kind, item))" /><EmptyState v-else :title="$t(&quot;这里已经处理妥当&quot;)" :description="$t(&quot;新的工作会显示在这里。&quot;)" /></section></div><aside class="ui-home-aside"><h2>{{ $t("项目空间") }}</h2><RouterLink v-for="project in projects.slice(0, 6)" :key="project.id" class="ui-project-shortcut" :to="{ name: 'project', params: { projectId: project.id } }"><span class="ui-project-monogram">{{ project.name.slice(0, 1) }}</span><span>{{ project.name }}<small class="muted">{{ project.status === 'archived' ? $t("已归档") : $t("进行中") }}</small></span><span aria-hidden="true">↗</span></RouterLink><RouterLink v-if="!projects.length" :to="{ name: 'projects' }">{{ $t("进入项目目录") }}</RouterLink><div class="ui-home-note"><span aria-hidden="true">✳</span><p>{{ $t("从一个清晰的想法开始。") }}</p><small>{{ $t("规划、协作、开发与交付，") }}<br />{{ $t("在同一个空间自然衔接。") }}</small></div></aside></div></section></template>
