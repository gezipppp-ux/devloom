import { onMounted, onUnmounted, ref } from "vue";
import { appApi } from "../../shared/api/api.js";

export function useEnvironment({ checkMissingVersions = false } = {}) {
  const report = ref(null), loading = ref(false), checking = ref(false), submitting = ref(false), busy = ref(false), error = ref(""), job = ref(null);
  const batch = ref(null);
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
      batch.value = result.batch || null;
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
      batch.value = result.batch || null;
      schedule();
    } catch (e) { if (!disposed && current === generation) error.value = e.message; }
    finally { if (!disposed && current === generation) { loading.value = false; checking.value = false; } }
  }
  async function update(tool) {
    if (submitting.value || busy.value) return false;
    submitting.value = true;
    error.value = "";
    try {
      const result = await appApi("/system/environment/update", { id: tool.id, version: tool.missing ? tool.installVersion : tool.latest, operation: tool.missing ? "install" : "update" });
      if (disposed) return false;
      job.value = result;
      busy.value = result.status === "running";
      schedule();
      return true;
    } catch (e) {
      if (!disposed) error.value = e.message;
      return false;
    } finally { if (!disposed) { submitting.value = false; if (job.value && !busy.value) await load(); } }
  }
  async function installMissing(tools) {
    if (submitting.value || busy.value || loading.value || checking.value) return;
    submitting.value = true; error.value = "";
    try {
      const result = await appApi("/system/environment/install", { tools: tools.map(tool => ({ id: tool.id, version: tool.installVersion })) });
      if (disposed) return;
      job.value = result.job; batch.value = result.batch; busy.value = result.busy;
      schedule();
    } catch (failure) { if (!disposed) error.value = failure.message; }
    finally { if (!disposed) { submitting.value = false; if (batch.value && !busy.value) await load(); } }
  }
  onMounted(async () => {
    await load();
    if (!disposed && checkMissingVersions && !busy.value && report.value?.tools.some(tool => ["git", "codex"].includes(tool.id) && tool.missing && !tool.installVersion)) await load(true);
  });
  onUnmounted(() => { disposed = true; generation++; clearTimeout(timer); });
  return { report, loading, checking, submitting, busy, error, job, batch, load, update, installMissing };
}
