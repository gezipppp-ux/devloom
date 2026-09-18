/* global window */
import { ref } from "vue";
import { apiPath } from "../../shared/api/api.js";

function readSavedKeys(storageKey) {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return Array.isArray(value)
      ? [...new Set(value.filter((key) => typeof key === "string"))]
      : [];
  } catch {
    return [];
  }
}

function saveKeys(storageKey, keys) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(keys));
  } catch {
    // The indicator remains available for this page when storage is blocked.
  }
}

export function useUnreadResults() {
  const storageKey = `unread-codex-results:${apiPath("/runs")}`;
  const keys = ref(readSavedKeys(storageKey));

  function replace(next) {
    keys.value = next;
    saveKeys(storageKey, next);
  }

  function markUnread(key) {
    if (!keys.value.includes(key)) replace([...keys.value, key]);
  }

  function markRead(key) {
    if (keys.value.includes(key))
      replace(keys.value.filter((entry) => entry !== key));
  }

  function retainRuns(runs) {
    const available = new Set(runs.map((run) => run.key));
    const next = keys.value.filter((key) => available.has(key));
    if (next.length !== keys.value.length) replace(next);
  }

  return { unreadResultKeys: keys, markUnread, markRead, retainRuns };
}
