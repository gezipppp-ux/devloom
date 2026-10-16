<script setup>
import { computed, watch } from "vue";
import { usePageTitle } from "../../shared/components/page-title.js";
import { translate } from "../../shared/i18n/index.js";
import { useRoute, useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import PageHeader from "../../shared/components/PageHeader.vue";
import PagePagination from "../../shared/components/PagePagination.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import EmptyState from "../../shared/components/EmptyState.vue";
import WorkActionList from "./WorkActionList.vue";
const props = defineProps({ projectId: { type: String, default: "" } });
const route = useRoute(), router = useRouter();
const bucket = computed(() => ['todo', 'doing', 'verify'].includes(route.query.bucket) ? route.query.bucket : 'todo');
const offset = computed(() => Math.max(0, Number(route.query.offset) || 0));
const titles = { todo: '待推进', doing: '处理中', verify: '待验证' };
usePageTitle(() => [translate(titles[bucket.value]), translate("工作台")]);
const descriptions = { todo: '当前需要你采取行动的工作', doing: '你已开始且仍在进行的工作', verify: '明确分派给你的测试与验收，包含验证中的工作' };
const { data, loading, error, reload } = useResource(() => appApi('/workbench/actions?' + new URLSearchParams({ bucket: bucket.value, offset: String(offset.value), ...(props.projectId ? { projectId: props.projectId } : {}) })), { interval: 30000 });
watch(() => route.fullPath, reload);
</script>
<template><section class="page-layout"><PageHeader :title="$t(titles[bucket])" :description="$t(descriptions[bucket])" /><nav class="page-tabs"><RouterLink v-for="(title, key) in titles" :key="key" :to="{ name: 'work', query: { ...(projectId ? { projectId } : {}), bucket: key } }" :class="{ active: bucket === key }">{{ $t(title) }}</RouterLink></nav><FeedbackMessage :message="error" type="error" /><button v-if="error" @click="reload">{{ $t('重新加载') }}</button><p v-if="loading">{{ $t('正在读取工作内容…') }}</p><template v-else-if="data"><p class="field-hint">{{ $t('共 {count} 个处理动作', { count: data.total }) }}</p><WorkActionList :items="data.items" /><EmptyState v-if="!data.items.length" :title="$t('当前没有分派给你的此类工作')" :description="$t('查看权限或关注关系不会自动生成个人待办。')" /><PagePagination :offset="offset" :total="data.total" :next-offset="data.nextOffset" @change="value => router.push({ query: { ...route.query, offset: value } })" /></template></section></template>
