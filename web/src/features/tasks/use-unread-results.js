import { onUnmounted, ref } from "vue";
import { appApi, currentWorkspaceId } from "../../shared/api/api.js";

export function useUnreadResults() {
  const workspaceId = currentWorkspaceId();
  const keys = ref([]), preferenceError = ref("");
  const changes = new Map();
  let disposed = false, loaded = false, available, saving = Promise.resolve();
  function persist() {
    const unreadRunKeys = [...keys.value];
    saving = saving.catch(() => {}).then(async () => {
      if (disposed) return;
      await appApi("/account/preferences", { workspaceId, unreadRunKeys });
    }).catch((error) => { if (!disposed) preferenceError.value = error.message; });
  }
  appApi(`/account/preferences?workspaceId=${encodeURIComponent(workspaceId)}`).then((result) => {
    if (disposed) return;
    const saved = new Set(result.preferences.unreadRunKeys);
    for (const [key, unread] of changes) { if (unread) saved.add(key); else saved.delete(key); }
    keys.value = [...saved].filter((key) => !available || available.has(key));
    loaded = true;
    if (changes.size || saved.size !== keys.value.length) persist();
    changes.clear();
  }).catch((error) => { if (!disposed) preferenceError.value = error.message; });
  function markUnread(key) {
    if (!loaded) changes.set(key, true);
    if (!keys.value.includes(key)) { keys.value = [...keys.value, key]; if (loaded) persist(); }
  }
  function markRead(key) {
    if (!loaded) changes.set(key, false);
    if (keys.value.includes(key)) { keys.value = keys.value.filter((entry) => entry !== key); if (loaded) persist(); }
  }
  function retainRuns(runs) {
    available = new Set(runs.map((run) => run.key));
    const next = keys.value.filter((key) => available.has(key));
    if (next.length !== keys.value.length) { keys.value = next; if (loaded) persist(); }
  }
  onUnmounted(() => { disposed = true; });
  return { unreadResultKeys: keys, preferenceError, markUnread, markRead, retainRuns };
}
