import { onUnmounted, ref } from "vue";
import { api } from "../../shared/api/api.js";

export function useArchivedSessions() {
  const runs = ref([]), loading = ref(false), error = ref("");
  const restoring = ref(""), restoreError = ref("");
  let pending, disposed = false;

  async function refresh() {
    if (disposed) return;
    const request = pending = { removed: new Set() };
    loading.value = true;
    error.value = "";
    try {
      const result = await api("/runs?archived=true");
      if (pending === request)
        runs.value = result.runs.filter((run) => !request.removed.has(run.key));
    } catch (e) {
      if (pending === request) error.value = e.message;
    } finally {
      if (pending === request) { loading.value = false; pending = null; }
    }
  }

  async function restore(key) {
    if (disposed || restoring.value) return false;
    restoring.value = key;
    restoreError.value = "";
    try {
      await api(`/runs/${key}/restore`, {});
      if (disposed) return false;
      remove(key);
      return true;
    } catch (e) {
      if (!disposed) restoreError.value = e.message;
      return false;
    } finally {
      if (!disposed) restoring.value = "";
    }
  }

  function remove(key) {
    pending?.removed.add(key);
    runs.value = runs.value.filter((run) => run.key !== key);
  }

  onUnmounted(() => { disposed = true; pending = null; });
  return { runs, loading, error, restoring, restoreError, refresh, restore, remove };
}
