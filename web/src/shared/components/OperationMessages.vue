<script setup>
/* global document, MutationObserver */
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { CheckCircleFilled, CloseCircleFilled, WarningFilled, InfoCircleFilled, CloseOutlined } from "@antdv-next/icons";
import { operationMessages, messageRevision, dismissMessage, pauseMessage, resumeMessage, clearMessages } from "./operation-messages.js";
import "../styles/operation-messages.css";

const host = ref(null);
const target = shallowRef("body");
const hovered = ref(false), focused = ref(false);
const expanded = computed(() => hovered.value || focused.value);
const messages = computed(() => [...operationMessages.value].reverse());
const icons = { success: CheckCircleFilled, error: CloseCircleFilled, warning: WarningFilled, info: InfoCircleFilled };
let alive = true;
let observer;
function locateTarget() {
  const dialogs = Array.from(document.querySelectorAll("dialog:modal"));
  const activeDialog = document.activeElement?.closest("dialog:modal");
  target.value = activeDialog || dialogs.at(-1) || "body";
}
watch([messageRevision, () => operationMessages.value.length, target], async () => {
  await nextTick();
  if (!alive) return;
  // Removing the focused oldest card at the queue limit does not dispatch blur.
  focused.value = Boolean(host.value?.contains(document.activeElement));
  if (!host.value?.showPopover) return;
  // Keep feedback in the active modal's subtree so its controls are not inert.
  // A manual popover then brings it above the dialog without moving focus.
  const opened = host.value.matches(":popover-open");
  if (!operationMessages.value.length && opened) host.value.hidePopover();
  else if (operationMessages.value.length && !opened) host.value.showPopover();
}, { immediate: true });
watch([expanded, messageRevision, () => operationMessages.value.length], () => {
  if (!operationMessages.value.length) { hovered.value = false; focused.value = false; }
  for (const item of operationMessages.value) (expanded.value ? pauseMessage : resumeMessage)(item.id);
});
function touchStack(event) {
  if (event.pointerType === "touch" && messages.value.length > 1 && !event.target.closest("button")) host.value?.focus({ preventScroll: true });
}
async function dismiss(id) {
  const hadFocus = host.value?.contains(document.activeElement);
  dismissMessage(id);
  await nextTick();
  if (hadFocus && messages.value.length) host.value?.querySelector(".operation-message-close")?.focus({ preventScroll: true });
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
    <div ref="host" popover="manual" class="operation-messages" role="region" :aria-label="$t(&quot;操作提示&quot;)"
      :tabindex="messages.length > 1 ? 0 : -1" :data-expanded="expanded"
      @pointerenter="hovered = $event.pointerType !== 'touch'" @pointerleave="hovered = false" @pointerdown="touchStack"
      @focusin="focused = true" @focusout="focused = Boolean(host?.contains($event.relatedTarget))">
      <div class="operation-message-stack">
        <div v-for="(item, depth) in messages" :key="item.id" class="operation-message" :data-type="item.type"
          :data-depth="depth" :style="{ '--message-depth': depth }"
          :role="['error', 'warning'].includes(item.type) ? 'alert' : 'status'" aria-atomic="true">
          <span class="operation-message-icon" aria-hidden="true"><component :is="icons[item.type]" /></span>
          <span class="operation-message-text">{{ $t(item.message) }}</span>
          <button type="button" class="operation-message-close" :aria-label="$t(&quot;关闭提示&quot;)" @click="dismiss(item.id)"><CloseOutlined aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
