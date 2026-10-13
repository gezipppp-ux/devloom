/* global window */
import { onMounted, onUnmounted, ref } from "vue";
import { api } from "./api.js";
import { subscribeSuppliers } from "./agent-supplier-events.js";

export function useModelCatalog(request = api) {
  const models = ref([]),
    loading = ref(false),
    error = ref("");
  let revision = 0;
  async function refresh() {
    const current = ++revision;
    loading.value = true;
    error.value = "";
    try {
      const result = await request("/models");
      if (current === revision) models.value = result.models;
    } catch (e) {
      if (current === revision) error.value = e.message;
    } finally {
      if (current === revision) loading.value = false;
    }
  }
  const unsubscribe = subscribeSuppliers(refresh);
  onMounted(() => { refresh(); window.addEventListener("focus", refresh); });
  onUnmounted(() => {
    revision++;
    unsubscribe(); window.removeEventListener("focus", refresh);
  });
  return { models, loading, error, refresh };
}
