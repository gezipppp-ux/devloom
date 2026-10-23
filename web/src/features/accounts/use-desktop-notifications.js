/* global window */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { accountSession, saveAccountSettings } from "../../shared/api/account-session.js";
import { translate } from "../../shared/i18n/index.js";
function notificationApi() { return "Notification" in window ? window.Notification : null; }
export function useDesktopNotifications() {
  const permission = ref(notificationApi()?.permission || "unsupported");
  const secureContext = ref(window.isSecureContext === true);
  const origin = window.location.origin;
  const enabled = computed(() => accountSession.settings.notificationsEnabled !== false);
  const available = computed(() => permission.value !== "unsupported");
  const status = computed(() => !secureContext.value ? "insecure" : permission.value);
  const error = ref(""), busy = ref(false);
  let disposed = false;
  function refreshPermission() {
    if (disposed) return;
    secureContext.value = window.isSecureContext === true;
    permission.value = notificationApi()?.permission || "unsupported";
  }
  onMounted(() => { refreshPermission(); window.addEventListener("focus", refreshPermission); });
  onUnmounted(() => { disposed = true; window.removeEventListener("focus", refreshPermission); });
  async function toggle() {
    if (busy.value || disposed) return;
    refreshPermission();
    if (!["granted", "default"].includes(status.value)) return;
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
    if (!api || disposed || status.value !== "granted" || !enabled.value) return;
    try { new api("Codex 已返回结果", { body: `“${title || "任务"}”已完成本轮回复。`, tag: `codex-result-${key}` }); }
    catch { /* Notification delivery is controlled by the operating system/browser. */ }
  }
  function notifyAttention(items) {
    const api = notificationApi();
    if (!api || disposed || status.value !== "granted" || !enabled.value) return;
    const labels = { approval: "执行审批", question: "需要回答", delivery: "待验证交付", issue: "待推进事项", task: "开发任务", session: "执行审批" };
    try {
      const shown = items.slice(0, 3).map(item => `${translate(item.label || labels[item.kind])} · ${item.title}`).join("\n");
      new api(translate("新增 {count} 条待处理内容", { count: items.length }), { body: shown, tag: "web-coding-attention" });
    } catch { /* Notification delivery is controlled by the operating system/browser. */ }
  }
  return { available, permission, secureContext, origin, status, enabled, busy, error, refreshPermission, toggle, notifyResult, notifyAttention };
}
