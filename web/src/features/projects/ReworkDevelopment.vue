<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";
import ModalDialog from "../../shared/components/ModalDialog.vue";
const props = defineProps({ projectId: { type: String, required: true }, task: { type: Object, required: true } });
const router = useRouter(), open = ref(false);
const { saving, error, save } = useResource(() => null, { immediate: false });
const requestId = createRequestId();
let request;
function create() {
  if (!props.task.canRework || saving.value) return;
  request ||= { requestId, revision: props.task.revision, deliveries: props.task.reworkDeliveries };
  return save(`/projects/${props.projectId}/tasks/${props.task.id}/rework`, request, result => {
    open.value = false;
    void router.push({ name: "project", params: { projectId: props.projectId }, query: { tab: "tasks", task: result.task.id } });
  });
}
</script>
<template>
  <button v-if="task.canRework" class="primary" @click="open = true">{{ $t('创建返工任务') }}</button>
  <ModalDialog v-if="open" open :title="$t('创建返工任务')" @close="!saving && (open = false)">
    <p class="project-text">{{ task.title }}</p>
    <p>{{ $t('原会话或工作目录已清理。确认后将取消旧任务，并将全部关联事项转入新的待开发任务；已有交付和验证状态保持不变。') }}</p>
    <p class="field-hint">{{ $t('创建不会启动 Agent。请在新任务中选择包含原交付代码的分支；已删除的本地代码和聊天记录不会恢复。') }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="actions"><button :disabled="saving" @click="open = false">{{ $t('返回') }}</button><button class="primary" :disabled="saving || !task.canRework" @click="create">{{ saving ? $t('正在提交…') : $t('确认创建返工任务') }}</button></div>
  </ModalDialog>
</template>
