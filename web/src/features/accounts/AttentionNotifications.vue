<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { BellOutlined, ArrowRightOutlined, ReloadOutlined } from "@antdv-next/icons";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
const props = defineProps({ attention: { type: Object, required: true }, compact: Boolean });
const open = ref(false), router = useRouter();
const items = computed(() => props.attention.data.value?.items || []);
const labels = { approval: "执行审批", question: "需要回答", delivery: "待验证交付", issue: "待推进事项", task: "开发任务", session: "执行审批" };
function location(item) { if (["issue", "task"].includes(item.kind)) return { name: "project", params: { projectId: item.projectId }, query: item.kind === "issue" ? { tab: "issues", issue: item.issueId } : { tab: "tasks", task: item.taskId } }; return item.kind === "delivery" ? { name: "deliveries", query: { projectId: item.projectId, delivery: item.deliveryId } } : { name: "workspace", query: { workspace: item.workspaceId, task: item.runKey } }; }
function select(item) { open.value = false; void router.push(location(item)); }
</script>
<template>
  <button v-if="compact" type="button" class="attention-trigger" :aria-label="$t('待我处理')" @click="open = true"><BellOutlined aria-hidden="true" /><span v-if="items.length" class="attention-count">{{ items.length }}</span></button>
  <section v-else class="attention-section" :aria-label="$t('待我处理')">
    <header><h2>{{ $t('待我处理') }} <span class="muted">{{ items.length }}</span></h2><button v-if="items.length > 5" class="text-button" @click="open = true">{{ $t('查看全部') }}<ArrowRightOutlined aria-hidden="true" /></button><button v-else class="text-button" :disabled="attention.loading.value" :aria-label="$t('刷新待处理内容')" @click="attention.reload()"><ReloadOutlined aria-hidden="true" /></button></header>
    <FeedbackMessage :message="attention.error.value" type="error" />
    <p v-if="attention.loading.value && !attention.data.value" class="muted" role="status">{{ $t('正在读取待处理内容…') }}</p>
    <p v-else-if="!items.length && !attention.error.value" class="attention-empty">{{ $t('暂时没有需要你处理的内容。') }}</p>
    <ul v-if="items.length" class="attention-list"><li v-for="item in items.slice(0, 5)" :key="item.id"><button @click="select(item)"><span class="attention-kind">{{ $t(item.label || labels[item.kind]) }}</span><span class="attention-item"><strong>{{ item.title }}</strong><small>{{ item.projectName }}</small></span><ArrowRightOutlined aria-hidden="true" /></button></li></ul>
    <button v-if="attention.error.value" :disabled="attention.loading.value" @click="attention.reload()">{{ $t('重新加载') }}</button>
  </section>
  <ModalDialog :open="open" :title="$t('待我处理')" @close="open = false">
    <div class="attention-modal"><div class="attention-modal-toolbar"><p class="muted">{{ $t('这里与工作台使用相同的分派规则，只展示轮到你处理的工作。') }}</p><button :disabled="attention.loading.value" @click="attention.reload()"><ReloadOutlined aria-hidden="true" />{{ $t('刷新') }}</button></div><FeedbackMessage :message="attention.error.value" type="error" /><p v-if="attention.loading.value && !attention.data.value" role="status">{{ $t('正在读取待处理内容…') }}</p><p v-else-if="!items.length && !attention.error.value" class="attention-empty">{{ $t('暂时没有需要你处理的内容。') }}</p><ul v-if="items.length" class="attention-list"><li v-for="item in items" :key="item.id"><button @click="select(item)"><span class="attention-kind">{{ $t(item.label || labels[item.kind]) }}</span><span class="attention-item"><strong>{{ item.title }}</strong><small>{{ item.projectName }}</small></span><ArrowRightOutlined aria-hidden="true" /></button></li></ul></div>
  </ModalDialog>
</template>
<style scoped>
.attention-trigger { position: relative; width: 40px; padding: 0; border-color: transparent; background: transparent; }
.attention-trigger > .anticon { font-size: 18px; }
.attention-count { position: absolute; top: -2px; right: -4px; min-width: 17px; padding: 2px 4px; background: var(--selected); color: var(--highlight); border-radius: 10px; font-size: 10px; line-height: 1.2; }
.attention-section { min-width: 0; margin-bottom: 32px; }
.attention-section > header { display: flex; align-items: center; gap: 16px; justify-content: space-between; margin-bottom: 18px; }
.attention-section h2 { margin: 0; font-size: 16px; }
.attention-section h2 .muted { margin-left: 6px; font-size: 12px; font-weight: 400; }
.attention-empty { margin: 0; padding: 20px 0; font-size: 13px; color: var(--muted); }
.attention-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
.attention-list > li + li { border-top: 1px solid var(--line); }
.attention-list > li > button { width: 100%; border: 0; border-radius: 0; padding: 18px 20px; gap: 16px; background: transparent; justify-content: flex-start; text-align: left; box-shadow: none; }
.attention-list > li > button:hover { background: var(--surface-hover); }
.attention-kind { color: var(--highlight); background: var(--selected); border-radius: 5px; padding: 4px 8px; font-size: 12px; }
.attention-item { flex: 1; min-width: 0; }
.attention-item strong { display: block; color: var(--ink); font-size: 13px; overflow-wrap: anywhere; }
.attention-item small { display: block; color: var(--muted); font-size: 12px; margin-top: 6px; overflow-wrap: anywhere; }
.attention-modal-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.attention-modal-toolbar p { margin: 0; max-width: 380px; font-size: 13px; line-height: 1.8; }
@media (max-width: 767px) { .attention-trigger { width: 44px; min-height: 44px; } .attention-list > li > button { flex-wrap: wrap; padding: 16px; gap: 10px; } .attention-item { flex-basis: calc(100% - 32px); order: 1; } .attention-list > li > button > .anticon { margin-left: auto; } }
</style>
