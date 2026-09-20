/* global window */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { accountSession, saveAccountSettings } from "../../shared/api/account-session.js";
function notificationApi() { return "Notification" in window ? window.Notification : null; }
export function useDesktopNotifications() {
  const permission = ref(notificationApi()?.permission || "unsupported");
  const enabled = computed(() => accountSession.settings.notificationsEnabled !== false);
  const available = computed(() => permission.value !== "unsupported");
  const error = ref(""), busy = ref(false);
  let disposed = false;
  onMounted(() => { permission.value = notificationApi()?.permission || "unsupported"; });
  onUnmounted(() => { disposed = true; });
  async function toggle() {
    if (busy.value || disposed) return;
    const generation = accountSession.generation;
    const current = () => !disposed && generation === accountSession.generation;
    busy.value = true; error.value = "";
    try {
      const api = notificationApi();
      if (!api) return;
      if (api.permission !== "granted") {
        const granted = await api.requestPermission();
        if (!current()) return;
        permission.value = granted;
        if (permission.value === "granted") await saveAccountSettings({ notificationsEnabled: true });
      } else await saveAccountSettings({ notificationsEnabled: !enabled.value });
      if (current()) permission.value = api.permission;
    } catch (failure) { if (current()) error.value = failure.message; }
    finally { if (current()) busy.value = false; }
  }
  function notifyResult({ key, title }) {
    const api = notificationApi();
    if (!api || permission.value !== "granted" || !enabled.value) return;
    try { new api("Codex 已返回结果", { body: `“${title || "任务"}”已完成本轮回复。`, tag: `codex-result-${key}` }); }
    catch { /* Notification delivery is controlled by the operating system/browser. */ }
  }
  return { available, permission, enabled, busy, error, toggle, notifyResult };
}
