/* global window */
import { computed, onMounted, ref } from "vue";
import { accountSession, saveAccountSettings } from "../../shared/api/account-session.js";
function notificationApi() { return "Notification" in window ? window.Notification : null; }
export function useDesktopNotifications() {
  const permission = ref(notificationApi()?.permission || "unsupported");
  const enabled = computed(() => accountSession.settings.notificationsEnabled !== false);
  const available = computed(() => permission.value !== "unsupported");
  const error = ref(""), busy = ref(false);
  onMounted(() => { permission.value = notificationApi()?.permission || "unsupported"; });
  async function toggle() {
    if (busy.value) return;
    busy.value = true; error.value = "";
    try {
      const api = notificationApi();
      if (!api) return;
      if (api.permission !== "granted") {
        permission.value = await api.requestPermission();
        if (permission.value === "granted") await saveAccountSettings({ notificationsEnabled: true });
      } else await saveAccountSettings({ notificationsEnabled: !enabled.value });
      permission.value = api.permission;
    } catch (failure) { error.value = failure.message; }
    finally { busy.value = false; }
  }
  function notifyResult({ key, title }) {
    const api = notificationApi();
    if (!api || permission.value !== "granted" || !enabled.value) return;
    try { new api("Codex 已返回结果", { body: `“${title || "任务"}”已完成本轮回复。`, tag: `codex-result-${key}` }); }
    catch { /* Notification delivery is controlled by the operating system/browser. */ }
  }
  return { available, permission, enabled, busy, error, toggle, notifyResult };
}
