import { onMounted, onUnmounted, ref } from "vue";
import { api } from "./api.js";

export function useModelCatalog() {
  const models = ref([]),
    loading = ref(false),
    error = ref("");
  let revision = 0;
  async function refresh() {
    const current = ++revision;
    loading.value = true;
    error.value = "";
    try {
      const result = await api("/models");
      if (current === revision) models.value = result.models;
    } catch (e) {
      if (current === revision) error.value = e.message;
    } finally {
      if (current === revision) loading.value = false;
    }
  }
  onMounted(refresh);
  onUnmounted(() => {
    revision++;
  });
  return { models, loading, error, refresh };
}
