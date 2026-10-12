<script setup>
import { onMounted, ref } from "vue";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
const props = defineProps({ projectId: { type: String, required: true }, tasks: { type: Array, required: true } });
const emit = defineEmits(["closed", "merged"]);
const dialog = ref(), title = ref(props.tasks[0]?.title || "");
const requestId = createRequestId();
const selection = props.tasks.map(({ id, revision }) => ({ id, revision }));
const { saving, error, save } = useResource(() => null, { immediate: false });
function close() { if (!saving.value) { dialog.value.close(); emit("closed"); } }
function submit() {
  return save(`/projects/${props.projectId}/tasks/merge`, { requestId, tasks: selection, title: title.value }, result => {
    dialog.value.close(); emit("merged", result.task);
  }, "开发任务已合并，确认开发分支后即可启动 Codex。");
}
onMounted(() => dialog.value.showModal());
</script>
<template>
  <dialog ref="dialog" class="workspace-dialog" aria-labelledby="merge-development-title" @cancel.prevent="close">
    <div class="workspace-dialog-heading"><h2 id="merge-development-title">合并开发任务</h2><button :disabled="saving" @click="close">取消</button></div>
    <FeedbackMessage :message="error" type="error" />
    <form class="project-form" @submit.prevent="submit">
      <p>将 {{ tasks.length }} 个待开发任务合并，共 {{ tasks.reduce((total, task) => total + task.issueIds.length, 0) }} 条事项。</p>
      <ul><li v-for="task in tasks" :key="task.id">{{ task.title }} · {{ task.release?.name || '未排期' }}</li></ul>
      <label>合并后的任务标题<input v-model="title" required maxlength="200" :disabled="saving" /></label>
      <p class="field-hint">原任务保留合并记录，所有需求和缺陷继续独立跟踪。合并后由一个 Codex 会话处理，确认开始开发后才会执行。</p>
      <div class="actions"><button class="primary" :disabled="saving || !title.trim()">{{ saving ? '正在合并…' : '确认合并' }}</button><button type="button" :disabled="saving" @click="close">返回</button></div>
    </form>
  </dialog>
</template>
