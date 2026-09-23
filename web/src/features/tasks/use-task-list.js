import { onUnmounted, ref } from "vue";
import { api } from "../../shared/api/api.js";
import { useUnreadResults } from "./use-unread-results.js";

export function useTaskList() {
  const runs = ref([]);
  const { unreadResultKeys, preferenceError, markUnread, markRead, retainRuns } =
    useUnreadResults();
  let pendingList;

  async function refresh() {
    const request = (pendingList = { metadata: new Map(), titles: new Map(), removed: new Set() });
    try {
      const result = await api("/runs");
      if (pendingList !== request) return;
      runs.value = result.runs.filter((run) => !request.removed.has(run.key)).map((run) => ({
        ...run,
        ...(request.metadata.has(run.key) ? { metadata: request.metadata.get(run.key) } : {}),
        ...(request.titles.has(run.key) ? { title: request.titles.get(run.key) } : {}),
      }));
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

  function updateTitle(key, title) {
    pendingList?.titles.set(key, title);
    const run = runs.value.find((entry) => entry.key === key);
    if (run) run.title = title;
  }

  function remove(key) {
    pendingList?.removed.add(key);
    runs.value = runs.value.filter((entry) => entry.key !== key);
    retainRuns(runs.value);
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
    updateTitle,
    remove,
  };
}
