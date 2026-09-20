import { onUnmounted, ref } from "vue";
import { appApi, currentWorkspaceId } from "../../shared/api/api.js";
import { accountSession } from "../../shared/api/account-session.js";

// Saving belongs to an account/workspace, even while its page is unmounted.
const preferenceQueues = new Map();

export function useUnreadResults() {
  const workspaceId = currentWorkspaceId();
  const generation = accountSession.generation;
  const identity = `${generation}:${workspaceId}`;
  const currentAccount = () => generation === accountSession.generation;
  const keys = ref([]), preferenceError = ref("");
  const changes = new Map();
  let disposed = false, loaded = false, available;
  function queue(operation) {
    const pending = (preferenceQueues.get(identity) || Promise.resolve()).catch(() => {}).then(async () => {
      if (!currentAccount()) return;
      await operation();
    }).catch((error) => { if (!disposed && currentAccount()) preferenceError.value = error.message; })
      .finally(() => { if (preferenceQueues.get(identity) === pending) preferenceQueues.delete(identity); });
    preferenceQueues.set(identity, pending);
  }
  function persist() {
    const unreadRunKeys = [...keys.value];
    queue(() => appApi("/account/preferences", { workspaceId, unreadRunKeys }));
  }
  queue(async () => {
    if (disposed && !changes.size) return;
    const result = await appApi(`/account/preferences?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (!currentAccount() || (disposed && !changes.size)) return;
    const saved = new Set(result.preferences.unreadRunKeys);
    for (const [key, unread] of changes) { if (unread) saved.add(key); else saved.delete(key); }
    const unreadRunKeys = [...saved].filter((key) => !available || available.has(key));
    if (!disposed) keys.value = unreadRunKeys;
    loaded = true;
    const changed = changes.size || saved.size !== unreadRunKeys.length;
    changes.clear();
    // Include pre-load reads in this operation so a remounted page waits for them.
    if (changed) await appApi("/account/preferences", { workspaceId, unreadRunKeys });
  });
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
