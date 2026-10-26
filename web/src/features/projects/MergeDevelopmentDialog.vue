<script setup>
import { computed, ref } from "vue";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";
import { formatNumber } from "../../shared/i18n/index.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import ModalDialog from "../../shared/components/ModalDialog.vue";
const props = defineProps({ projectId: { type: String, required: true }, tasks: { type: Array, required: true } });
const emit = defineEmits(["closed", "merged"]);
const visible = ref(true), title = ref(props.tasks[0]?.title || "");
const issueCount = computed(() => props.tasks.reduce((total, task) => total + task.issueIds.length, 0));
const requestId = createRequestId();
const selection = props.tasks.map(({ id, revision }) => ({ id, revision }));
const { saving, error, save } = useResource(() => null, { immediate: false });
function close() { if (!saving.value) { visible.value = false; emit("closed"); } }
function submit() {
  if (saving.value || !title.value.trim()) return;
  return save(`/projects/${props.projectId}/tasks/merge`, { requestId, tasks: selection, title: title.value }, result => {
    visible.value = false; emit("merged", result.task);
  }, "开发任务已合并，确认开发分支后即可启动 Codex。");
}
</script>
<template>
  <ModalDialog :open="visible" :title="$t('合并开发任务')" class="merge-development-dialog" @close="close">
    <template #header>
      <div class="merge-development-heading">
        <h2>{{ $t("合并开发任务") }}</h2>
        <p>{{ $t("{tasks} 个待开发任务，关联 {issues} 条事项", { tasks: formatNumber(tasks.length), issues: formatNumber(issueCount) }) }}</p>
      </div>
      <button type="button" :aria-label="$t('关闭弹窗')" :disabled="saving" @click="close">×</button>
    </template>
    <form id="merge-development-form" class="merge-development-form" :aria-busy="saving" @submit.prevent="submit">
      <FeedbackMessage :message="error" type="error" />
      <section aria-labelledby="merge-development-scope">
        <h3 id="merge-development-scope">{{ $t("本次合并") }}<span>{{ $t("{count} 个任务", { count: formatNumber(tasks.length) }) }}</span></h3>
        <ol class="merge-development-tasks">
          <li v-for="(task, index) in tasks" :key="task.id">
            <span class="merge-development-index" aria-hidden="true">{{ formatNumber(index + 1) }}</span>
            <div><p class="merge-development-task-title">{{ task.title }}</p><p class="merge-development-task-meta">#{{ task.id.slice(0, 8) }} · {{ task.release?.name || $t("未排期") }}</p></div>
          </li>
        </ol>
      </section>
      <div class="merge-development-field">
        <div class="merge-development-label"><label for="merge-development-task-title">{{ $t("合并后的任务标题") }}</label><span>{{ formatNumber(title.length) }} / {{ formatNumber(200) }}</span></div>
        <textarea id="merge-development-task-title" v-model="title" required maxlength="200" rows="2" :disabled="saving" aria-describedby="merge-development-title-hint" />
        <p id="merge-development-title-hint">{{ $t("使用一个标题概括本次开发范围。") }}</p>
      </div>
      <div class="merge-development-note"><p>{{ $t("原任务保留合并记录，关联事项继续独立跟踪。") }}</p><p>{{ $t("合并后仍需手动开始开发。") }}</p></div>
    </form>
    <template #footer>
      <button type="button" :disabled="saving" @click="close">{{ $t("取消") }}</button>
      <button class="primary" type="submit" form="merge-development-form" :disabled="saving || !title.trim()">{{ saving ? $t("正在合并…") : $t("确认合并") }}</button>
    </template>
  </ModalDialog>
</template>
