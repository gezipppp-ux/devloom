import { onUnmounted, ref, watch } from "vue";
import { api } from "../../shared/api/api.js";

export function useTapdSelection(workspace) {
  const query = ref(""), results = ref([]), searching = ref(false), error = ref(""), searched = ref(false);
  let revision = 0;
  watch(workspace, () => { revision++; results.value = []; searched.value = false; searching.value = false; error.value = ""; });
  onUnmounted(() => { revision++; });
  async function search() {
    if (!workspace() || searching.value) return;
    const current = ++revision;
    searching.value = true;
    error.value = "";
    try {
      const response = await api(`/requirements?${new URLSearchParams({ channel: "tapd", workspace: workspace(), query: query.value })}`);
      if (revision === current) { results.value = response.items; searched.value = true; }
    } catch (e) { if (revision === current) error.value = e.message; }
    finally { if (revision === current) searching.value = false; }
  }
  return { query, results, searching, error, searched, search };
}
