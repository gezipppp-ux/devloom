<script setup>
import { BellOutlined, SettingOutlined } from "@antdv-next/icons";

const props = defineProps({
  notificationAvailable: Boolean,
  notificationPermission: { type: String, default: "unsupported" },
  notificationsEnabled: Boolean,
});
const emit = defineEmits(["notifications-toggle"]);

function notificationLabel() {
  if (props.notificationPermission === "granted")
    return props.notificationsEnabled ? "关闭桌面通知" : "开启桌面通知";
  if (props.notificationPermission === "denied") return "桌面通知已关闭";
  return "开启桌面通知";
}
</script>

<template>
  <div class="system-settings-view">
    <slot name="workspace-rail" />
    <main class="system-settings-main">
      <div class="page-breadcrumb" aria-label="当前位置">
        <span>系统</span><span aria-hidden="true">/</span><strong>系统设置</strong>
      </div>
      <section class="system-settings-panel">
        <div class="page-heading">
          <div class="eyebrow">SYSTEM</div>
          <h1><SettingOutlined aria-hidden="true" /> 系统设置</h1>
          <p>管理此浏览器上的工作台提醒偏好。</p>
        </div>
        <section
          class="system-setting-row"
          aria-labelledby="desktop-notifications-title"
        >
          <div>
            <h2 id="desktop-notifications-title">桌面通知</h2>
            <p>
              Codex 返回未读结果时发送系统通知。此项默认开启；首次使用时浏览器会请求授权。
            </p>
          </div>
          <button
            v-if="notificationAvailable"
            :disabled="notificationPermission === 'denied'"
            :title="
              notificationPermission === 'denied'
                ? '请在浏览器的网站权限中重新允许通知'
                : notificationsEnabled
                  ? '关闭未读 Codex 回复的系统通知'
                  : '收到未读 Codex 回复时显示系统通知'
            "
            @click="emit('notifications-toggle')"
          >
            <BellOutlined aria-hidden="true" /> {{ notificationLabel() }}
          </button>
          <p v-else class="muted">当前浏览器不支持系统桌面通知。</p>
        </section>
        <p
          v-if="notificationPermission === 'denied'"
          class="field-hint"
          role="status"
        >
          浏览器已拦截通知，请在网站权限中允许后重新打开此页。
        </p>
      </section>
    </main>
  </div>
</template>
