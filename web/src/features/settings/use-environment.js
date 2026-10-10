import { onMounted, onUnmounted, ref } from "vue";
import { appApi } from "../../shared/api/api.js";

export function useEnvironment() {
  const report = ref(null), loading = ref(false), checking = ref(false), submitting = ref(false), busy = ref(false), error = ref(""), job = ref(null);
  let disposed = false, generation = 0, timer;
  function schedule() {
    clearTimeout(timer);
    if (!disposed && busy.value) timer = setTimeout(poll, 2000);
  }
  async function poll() {
    try {
      const result = await appApi("/system/environment/update");
      if (disposed) return;
      job.value = result.job;
      busy.value = result.busy;
      if (!busy.value) await load();
    } catch (e) { if (!disposed) error.value = e.message; }
    finally { schedule(); }
  }
  async function load(latest = false) {
    if (loading.value || checking.value || submitting.value) return;
    const current = ++generation;
    (latest ? checking : loading).value = true;
    error.value = "";
    try {
      const result = await appApi(latest ? "/system/environment/check" : "/system/environment", latest ? {} : undefined);
      if (disposed || current !== generation) return;
      report.value = result;
      busy.value = result.busy;
      job.value = result.job;
      schedule();
    } catch (e) { if (!disposed && current === generation) error.value = e.message; }
    finally { if (!disposed && current === generation) { loading.value = false; checking.value = false; } }
  }
  async function update(tool) {
    if (submitting.value || busy.value) return false;
    submitting.value = true;
    error.value = "";
    try {
      const result = await appApi("/system/environment/update", { id: tool.id, version: tool.latest });
      if (disposed) return false;
      job.value = result;
      busy.value = result.status === "running";
      schedule();
      return true;
    } catch (e) {
      if (!disposed) error.value = e.message;
      return false;
    } finally { if (!disposed) submitting.value = false; }
  }
  onMounted(() => load());
  onUnmounted(() => { disposed = true; generation++; clearTimeout(timer); });
  return { report, loading, checking, submitting, busy, error, job, load, update };
}
