<script setup>
/* global document */
import { computed, onMounted, onUnmounted, ref } from "vue";
const props = defineProps({
  action: { type: String, required: true },
  title: { type: String, required: true },
  busy: Boolean,
  disabled: Boolean,
});
const emit = defineEmits(["confirm", "closed"]);
const dialog = ref();
const copy = computed(
  () =>
    ({
      complete: {
        title: "确认完成开发任务",
        description:
          "完成后释放关联事项的认领，保留开发负责人和历史；此会话转为只读。需求与 Bug 的验收状态保持不变。",
        button: "确认完成开发任务",
      },
      cancel: {
        title: "取消任务并释放认领",
        description:
          "取消后释放关联事项的认领并清空开发负责人，保留任务历史。此任务不能继续执行。",
        button: "确认取消任务",
      },
      remove: {
        title: "移出关联事项",
        description:
          "移出后，该事项不再属于本次开发范围，并释放认领、清空开发负责人。事项本身及其历史仍保留。",
        button: "确认移出事项",
      },
    })[props.action],
);
let previousFocus;
function close() {
  if (!props.busy) {
    dialog.value.close();
    emit("closed");
  }
}
onMounted(() => {
  previousFocus = document.activeElement;
  dialog.value.showModal();
});
onUnmounted(() => {
  dialog.value?.close();
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>
<template>
  <dialog
    ref="dialog"
    class="workspace-dialog development-confirmation"
    aria-labelledby="development-confirmation-title"
    @cancel.prevent="close"
  >
    <div class="workspace-dialog-heading">
      <h2 id="development-confirmation-title">{{ $t(copy.title) }}</h2>
      <button :disabled="busy" :aria-label="$t('关闭确认')" @click="close">
        {{ $t("关闭") }}
      </button>
    </div>
    <p class="development-confirmation-target">{{ title }}</p>
    <p>{{ $t(copy.description) }}</p>
    <p v-if="disabled && !busy" class="warning">
      {{ $t("任务状态已变化，请关闭窗口并刷新任务。") }}
    </p>
    <div class="actions">
      <button autofocus :disabled="busy" @click="close">{{ $t("返回") }}</button
      ><button
        :class="action === 'complete' ? 'primary' : 'danger-button'"
        :disabled="busy || disabled"
        @click="emit('confirm')"
      >
        {{ busy ? $t("正在提交…") : copy.button }}
      </button>
    </div>
  </dialog>
</template>
