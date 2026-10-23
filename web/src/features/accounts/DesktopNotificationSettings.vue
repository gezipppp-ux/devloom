<script setup>
import { computed, ref } from "vue";
import { InfoCircleOutlined } from "@antdv-next/icons";
import FormSection from "../../shared/components/FormSection.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import DesktopNotificationHelp from "./DesktopNotificationHelp.vue";
const props = defineProps({ notifications: { type: Object, required: true } });
const helpOpen = ref(false);
const status = computed(() => props.notifications.status.value);
const checked = computed(() => props.notifications.enabled.value && status.value === "granted");
const disabled = computed(() => props.notifications.busy.value || !["granted", "default"].includes(status.value));
</script>
<template>
  <FormSection class="desktop-notification-settings" :title="$t('通知')">
    <div class="notification-setting-row"><div><strong>{{ $t("需要我处理时提醒") }}</strong><p>{{ $t("浏览器打开应用期间，提醒新的执行审批、提问、待验证交付和 Codex 未读结果。每台设备需单独允许通知。") }}</p></div>
      <button type="button" class="notification-switch" role="switch" :aria-label="$t('需要我处理时提醒')" :aria-checked="checked" :aria-describedby="['insecure', 'unsupported', 'denied'].includes(status) ? 'desktop-notification-hint' : undefined" :title="checked ? $t('关闭桌面通知') : $t('开启桌面通知')" :disabled="disabled" @click="notifications.toggle"><span aria-hidden="true" /></button>
    </div>
    <div v-if="status === 'insecure'" id="desktop-notification-hint" class="notification-connection-hint">
      <InfoCircleOutlined aria-hidden="true" /><div><strong>{{ $t("当前连接暂时无法使用桌面通知") }}</strong><p>{{ $t("当前访问方式不满足浏览器的安全要求，请选择一种方式开启通知。") }}</p></div>
      <button type="button" class="text-button" aria-haspopup="dialog" @click="helpOpen = true">{{ $t("如何开启") }}</button>
    </div>
    <p v-else-if="status === 'unsupported'" id="desktop-notification-hint" class="field-hint">{{ $t("当前浏览器不支持系统桌面通知。") }}</p>
    <p v-else-if="status === 'denied'" id="desktop-notification-hint" class="field-hint">{{ $t("当前连接符合要求。请在地址栏左侧的网站设置中允许通知，然后刷新页面。") }}</p>
    <FeedbackMessage :message="notifications.error.value" type="error" />
    <DesktopNotificationHelp v-if="helpOpen" :origin="notifications.origin" :status="status" @close="helpOpen = false" @recheck="notifications.refreshPermission" />
  </FormSection>
</template>
<style scoped>
.notification-setting-row { display: flex; justify-content: space-between; align-items: center; gap: 24px; min-width: 0; }
.notification-setting-row strong { font-size: 13px; }
.notification-setting-row p { margin: 6px 0 0; max-width: 760px; font-size: 12px; line-height: 1.8; color: var(--muted); }
.notification-switch { position: relative; flex: 0 0 44px; width: 44px; height: 44px; min-height: 44px; border: 0; padding: 0; background: transparent; }
.notification-switch::before { content: ''; position: absolute; inset: 11px 0; border-radius: 20px; background: var(--field-border); }
.notification-switch span { position: absolute; top: 13px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--surface); transition: transform .15s ease; }
.notification-switch[aria-checked="true"]::before { background: var(--highlight); }
.notification-switch[aria-checked="true"] span { transform: translateX(22px); }
.notification-switch:hover:not(:disabled) { background: transparent; }
.notification-connection-hint { display: flex; align-items: flex-start; gap: 10px; margin-top: 18px; }
.notification-connection-hint > .anticon { color: var(--warning); flex: 0 0 18px; margin-top: 3px; }
.notification-connection-hint > div { flex: 1; min-width: 0; }
.notification-connection-hint strong { font-size: 13px; font-weight: 500; }
.notification-connection-hint p { margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 1.7; }
.notification-connection-hint > button { color: var(--highlight); flex-shrink: 0; }
@media (max-width: 767px) { .notification-setting-row { gap: 12px; }.notification-connection-hint { flex-wrap: wrap; }.notification-connection-hint > button { margin-left: 28px; min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .notification-switch span { transition: none; } }
</style>
