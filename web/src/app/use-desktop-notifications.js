/* global window */
import { computed, onMounted, ref } from "vue";

const storageKey = "desktop-notifications";

function notificationApi() {
  return typeof window !== "undefined" && "Notification" in window
    ? window.Notification
    : null;
}

function readEnabled() {
  try {
    return window.localStorage.getItem(storageKey) !== "false";
  } catch {
    return true;
  }
}

function saveEnabled(enabled) {
  try {
    window.localStorage.setItem(storageKey, String(enabled));
  } catch {
    // Notifications remain controllable for the current page.
  }
}

export function useDesktopNotifications() {
  const permission = ref(notificationApi()?.permission || "unsupported");
  const enabled = ref(readEnabled());
  const available = computed(() => permission.value !== "unsupported");

  onMounted(() => {
    permission.value = notificationApi()?.permission || "unsupported";
  });

  async function requestPermission() {
    const api = notificationApi();
    if (!api || permission.value !== "default") return permission.value;
    try {
      permission.value = await api.requestPermission();
    } catch {
      permission.value = api.permission || "denied";
    }
    if (permission.value === "granted") {
      enabled.value = true;
      saveEnabled(true);
    }
    return permission.value;
  }

  async function toggle() {
    if (permission.value !== "granted") return requestPermission();
    enabled.value = !enabled.value;
    saveEnabled(enabled.value);
    return permission.value;
  }

  function notifyResult({ key, title }) {
    const api = notificationApi();
    if (!api || permission.value !== "granted" || !enabled.value) return;
    try {
      new api("Codex 已返回结果", {
        body: `“${title || "任务"}”已完成本轮回复。`,
        tag: `codex-result-${key}`,
      });
    } catch {
      // Notification delivery is controlled by the operating system/browser.
    }
  }

  return { available, permission, enabled, toggle, notifyResult };
}
