<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import PageHeader from "../../shared/components/PageHeader.vue";
import FilterBar from "../../shared/components/FilterBar.vue";
import EmptyState from "../../shared/components/EmptyState.vue";
import PagePagination from "../../shared/components/PagePagination.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import WorkItemList from "./WorkItemList.vue";
import DeliveryDetail from "./DeliveryDetail.vue";
import PublishDelivery from "./PublishDelivery.vue";
import { workLocation } from "./work-navigation.js";
const props = defineProps({ kind: { type: String, required: true }, projectId: { type: String, default: "" }, canPublish: Boolean });
const emit = defineEmits(["create"]);
const route = useRoute(), router = useRouter();
const query = ref(String(route.query.q || ""));
const publishing = ref(route.query.publish === "1");
const scope = ref(String(route.query.scope || "all")), type = ref(String(route.query.type || "")), status = ref(String(route.query.status || ""));
const offset = computed(() => Math.max(0, Number.parseInt(route.query.offset, 10) || 0));
const headings = { issues: ["事项", "把想法写清楚，让协作有据可循。"], tasks: ["开发", "整理范围，准备环境，专注下一次推进。"], deliveries: ["交付", "每一份成果，都有清晰的验证与反馈。"] };
const { data, loading, error, reload } = useResource(() => {
  const params = new URLSearchParams({ query: String(route.query.q || ""), scope: String(route.query.scope || "all"), type: String(route.query.type || ""), status: String(route.query.status || ""), offset: String(offset.value), ...(props.projectId ? { projectId: props.projectId } : {}) });
  return appApi(`/workbench/${props.kind}?${params}`);
});
watch(() => route.fullPath, () => { query.value = String(route.query.q || ""); scope.value = String(route.query.scope || "all"); type.value = String(route.query.type || ""); status.value = String(route.query.status || ""); void reload(); });
function search() { void router.push({ query: { ...route.query, q: query.value || undefined, scope: scope.value, type: type.value || undefined, status: status.value || undefined, offset: undefined } }); }
</script>
<template><section class="page-layout work-queue"><PublishDelivery v-if="publishing && canPublish && projectId" :project-id="projectId" @close="publishing = false" @published="delivery => { publishing = false; router.push({ name: 'deliveries', query: { projectId, delivery: delivery.id } }); }" /><DeliveryDetail v-if="kind === 'deliveries' && route.query.delivery && projectId" :key="String(route.query.delivery)" :project-id="projectId" :delivery-id="String(route.query.delivery)" @back="router.push({ query: { ...route.query, delivery: undefined } })" /><template v-else><PageHeader :title="$t(headings[kind][0])" :description="$t(headings[kind][1])"><button v-if="kind === 'issues'" class="primary" @click="emit('create')">{{ $t("＋ 新建事项") }}</button><button v-else-if="kind === 'deliveries' && canPublish" class="primary" @click="publishing = true">{{ $t('发布交付') }}</button><button v-else-if="kind === 'tasks'" @click="emit('create', 'development')">{{ $t("准备开发环境") }}</button></PageHeader><FilterBar v-model="query" :busy="loading" :placeholder="kind === 'issues' ? $t(&quot;搜索事项标题、描述或标签&quot;) : $t(&quot;搜索标题或交付内容&quot;)" @search="search"><select v-if="kind !== 'tasks'" v-model="scope" :aria-label="$t(&quot;工作范围&quot;)" @change="search"><option value="all">{{ $t("全部") }}</option><option value="mine">{{ $t("与我有关") }}</option></select><select v-if="kind === 'issues'" v-model="type" :aria-label="$t(&quot;事项类型&quot;)" @change="search"><option value="">{{ $t("全部类型") }}</option><option value="requirement">{{ $t("需求") }}</option><option value="bug">{{ $t("缺陷") }}</option></select><select v-if="kind === 'deliveries'" v-model="status" :aria-label="$t(&quot;验收状态&quot;)" @change="search"><option value="">{{ $t("全部状态") }}</option><option value="pending">{{ $t("待验证") }}</option><option value="accepted">{{ $t("已通过") }}</option><option value="returned">{{ $t("已退回") }}</option></select></FilterBar><FeedbackMessage :message="error" type="error" /><button v-if="error" @click="reload">{{ $t("重试") }}</button><p v-if="loading" role="status">{{ $t("正在加载…") }}</p><WorkItemList v-if="data?.items.length" :items="data.items" :people="data.people" :kind="kind" @open="item => router.push(workLocation(kind, item))" /><EmptyState v-else-if="data && !loading" :title="$t(&quot;暂无符合条件的内容&quot;)" :description="$t(&quot;试试调整筛选，或从项目中开始新的工作。&quot;)" /><PagePagination :offset="offset" :total="data?.total" :next-offset="data?.nextOffset" :disabled="loading" @change="value => router.push({ query: { ...route.query, offset: value || undefined } })" /></template></section></template>
