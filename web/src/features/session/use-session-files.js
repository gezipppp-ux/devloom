import { onUnmounted, ref, watch } from "vue";
import { api } from "../../shared/api/api.js";

export function useSessionFileList(taskKey, scope) {
  const files = ref([]), loading = ref(false), error = ref("");
  let generation = 0;
  async function refresh() {
    const current = ++generation;
    files.value = [];
    error.value = "";
    loading.value = true;
    try {
      const data = await api(`/runs/${taskKey()}/files?scope=${scope.value}`);
      if (current === generation) files.value = data.files;
    } catch (e) {
      if (current === generation) error.value = e.message;
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  watch([taskKey, scope], refresh, { immediate: true });
  onUnmounted(() => { generation++; });
  return { files, loading, error, refresh };
}

export function useSessionFile(taskKey, requested, scope) {
  const file = ref(null), loading = ref(false), error = ref("");
  let generation = 0;
  async function refresh() {
    const current = ++generation;
    file.value = null;
    error.value = "";
    loading.value = true;
    try {
      const data = await api(`/runs/${taskKey()}/file?${new URLSearchParams({ path: requested(), scope: scope.value })}`);
      if (current === generation) file.value = data;
    } catch (e) {
      if (current === generation) error.value = e.message;
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  watch([taskKey, requested, scope], refresh, { immediate: true });
  onUnmounted(() => { generation++; });
  return { file, loading, error, refresh };
}
