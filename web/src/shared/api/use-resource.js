/* global setInterval, clearInterval */
import { onMounted, onUnmounted, ref } from "vue";
import { appApi } from "./api.js";

// Each mounted page owns its requests. Refreshes cannot overwrite newer loads.
export function useResource(load, { immediate = true, interval = 0 } = {}) {
  const data = ref(null), loading = ref(false), saving = ref(false), error = ref(""), notice = ref("");
  let alive = true, generation = 0, timer;
  async function reload() {
    const expected = ++generation;
    loading.value = true; error.value = "";
    try {
      const result = await load();
      if (alive && expected === generation) data.value = result;
    } catch (failure) {
      if (alive && expected === generation) {
        error.value = failure.message;
        if ([401, 403, 404].includes(failure.status)) data.value = null;
      }
    } finally { if (alive && expected === generation) loading.value = false; }
  }
  async function perform(operation, accept = () => {}, message = "已保存。") {
    if (saving.value || !alive) return;
    saving.value = true; error.value = ""; notice.value = "";
    try {
      const result = await operation();
      if (!alive) return;
      generation++; loading.value = false;
      accept(result); notice.value = message;
      return result;
    } catch (failure) { if (alive) error.value = failure.message; }
    finally { if (alive) saving.value = false; }
  }
  function save(url, input, accept, message) { return perform(() => appApi(url, input), accept, message); }
  if (immediate) onMounted(reload);
  if (interval) onMounted(() => { timer = setInterval(() => { if (!loading.value && !saving.value) void reload(); }, interval); });
  onUnmounted(() => { alive = false; generation++; clearInterval(timer); });
  return { data, loading, saving, error, notice, reload, save, perform };
}
