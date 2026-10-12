<script setup>
/* global document, MutationObserver */
import { nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, InfoCircleFilled, CloseOutlined } from "@antdv-next/icons";
import { operationMessages, messageRevision, dismissMessage, pauseMessage, resumeMessage, clearMessages } from "./operation-messages.js";
import "../styles/operation-messages.css";

const host = ref(null);
const target = shallowRef("body");
const icons = { success: CheckCircleFilled, error: CloseCircleFilled, warning: ExclamationCircleFilled, info: InfoCircleFilled };
let alive = true;
let observer;
function locateTarget() {
  const dialogs = Array.from(document.querySelectorAll("dialog:modal"));
  const activeDialog = document.activeElement?.closest("dialog:modal");
  target.value = activeDialog || dialogs.at(-1) || "body";
}
watch([messageRevision, () => operationMessages.value.length, target], async () => {
  await nextTick();
  if (!alive || !host.value?.showPopover) return;
  // Keep feedback in the active modal's subtree so its controls are not inert.
  // A manual popover then brings it above the dialog without moving focus.
  const opened = host.value.matches(":popover-open");
  if (!operationMessages.value.length && opened) host.value.hidePopover();
  else if (operationMessages.value.length && !opened) host.value.showPopover();
}, { immediate: true });
function resume(event, id) {
  const card = event.currentTarget;
  if (!card.matches(":hover") && !card.contains(document.activeElement)) resumeMessage(id);
}
onMounted(() => {
  locateTarget();
  observer = new MutationObserver(locateTarget);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
});
onUnmounted(() => { alive = false; observer?.disconnect(); clearMessages(); });
</script>
<template>
  <Teleport :to="target">
    <div ref="host" popover="manual" class="operation-messages" aria-label="操作提示">
      <div v-for="item in operationMessages" :key="item.id" class="operation-message" :data-type="item.type"
        :role="['error', 'warning'].includes(item.type) ? 'alert' : 'status'" aria-atomic="true"
        @mouseenter="pauseMessage(item.id)" @mouseleave="resume($event, item.id)"
        @focusin="pauseMessage(item.id)" @focusout="resume($event, item.id)">
        <component :is="icons[item.type]" class="operation-message-icon" aria-hidden="true" />
        <span class="operation-message-text">{{ item.message }}</span>
        <button type="button" class="operation-message-close" aria-label="关闭提示" @click="dismissMessage(item.id)"><CloseOutlined aria-hidden="true" /></button>
      </div>
    </div>
  </Teleport>
</template>
