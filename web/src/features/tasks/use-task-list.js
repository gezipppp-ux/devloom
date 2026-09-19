import { onUnmounted, ref } from "vue";
import { api } from "../../shared/api/api.js";
import { useUnreadResults } from "./use-unread-results.js";

export function useTaskList() {
  const runs = ref([]);
  const { unreadResultKeys, preferenceError, markUnread, markRead, retainRuns } =
    useUnreadResults();
  let pendingList;

  async function refresh() {
    const request = (pendingList = { metadata: new Map() });
    try {
      const result = await api("/runs");
      if (pendingList !== request) return;
      runs.value = result.runs.map((run) =>
        request.metadata.has(run.key)
          ? { ...run, metadata: request.metadata.get(run.key) }
          : run,
      );
      retainRuns(runs.value);
    } catch (e) {
      if (pendingList === request) throw e;
    } finally {
      if (pendingList === request) pendingList = null;
    }
  }

  function updateMetadata(key, metadata) {
    pendingList?.metadata.set(key, metadata);
    const run = runs.value.find((entry) => entry.key === key);
    if (run) run.metadata = metadata;
  }

  onUnmounted(() => {
    pendingList = null;
  });

  return {
    runs,
    unreadResultKeys,
    preferenceError,
    markUnread,
    markRead,
    refresh,
    updateMetadata,
  };
}
