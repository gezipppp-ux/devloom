/* global window, TextEncoder */
import { computed, onUnmounted, ref, watch } from "vue";
import { api, apiPath, currentWorkspaceId } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";

const channel = "devloom-preview-v1";
function snapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("预览状态格式无效。");
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > 16384) throw new Error("预览状态不能超过 16 KiB。");
  return JSON.parse(encoded);
}
function controlDescriptors(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 144).filter(d => d && typeof d.id === "string" && d.id.length < 200 &&
    typeof d.label === "string" && d.label.length <= 120 && ["slider", "color", "toggle", "select"].includes(d.kind) &&
    (d.kind !== "slider" || [d.min, d.max, d.step].every(Number.isFinite) && d.max >= d.min && d.step > 0) &&
    (d.kind !== "select" || Array.isArray(d.options) && d.options.length <= 12 && d.options.every(option =>
      typeof option?.value === "string" && option.value.length <= 200 && typeof option.label === "string" && option.label.length <= 200)));
}

export function useSessionPreview(props, emit) {
  const workspace = currentWorkspaceId();
  const selected = ref(props.preview.id), data = ref(null), frame = ref(), src = ref(""),
    loading = ref(false), error = ref(""), controls = ref([]), height = ref(320), width = ref(0),
    ready = ref(false), saving = ref(false), dirty = ref(false), conflict = ref(false);
  let generation = 0, token = "", timer, deadline, alive = true, edit = 0;
  const current = () => alive && currentWorkspaceId() === workspace;
  const readonly = computed(() => props.readonly || !data.value?.latest || data.value.version < props.latestVersion);
  const state = ref({ widget: null, controls: {} });
  const post = (type, fields = {}) => frame.value?.contentWindow?.postMessage({ channel, token, type, ...fields }, "*");

  async function load() {
    if (!current()) return;
    const version = ++generation;
    clearTimeout(timer); clearTimeout(deadline);
    src.value = ""; ready.value = false; controls.value = []; data.value = null; height.value = 320; width.value = 0;
    error.value = ""; dirty.value = false; conflict.value = false; loading.value = true; saving.value = false;
    token = createRequestId();
    try {
      const result = await api(`/runs/${props.runKey}/previews/${selected.value}`);
      if (!current() || generation !== version) return;
      data.value = result; state.value = snapshot(result.state);
      src.value = `${apiPath(`/runs/${props.runKey}/previews/${selected.value}/content`)}#${token}`;
      deadline = setTimeout(() => { if (!ready.value && version === generation) error.value = "预览加载失败，请重新载入。"; }, 15000);
    } catch (e) { if (version === generation && alive) error.value = e.message; }
    finally { if (version === generation && alive) loading.value = false; }
  }
  async function save() {
    if (!current() || readonly.value || !dirty.value || saving.value || conflict.value || !data.value) return;
    const version = generation, currentEdit = edit, id = selected.value;
    saving.value = true; error.value = "";
    try {
      const result = await api(`/runs/${props.runKey}/previews/${id}/state`, { revision: data.value.revision, state: snapshot(state.value) });
      if (!current() || version !== generation) return;
      data.value.revision = result.revision; data.value.savedAt = result.savedAt;
      dirty.value = currentEdit !== edit;
    } catch (e) {
      if (current() && version === generation) { error.value = e.message; conflict.value = e.status === 409; }
    } finally {
      if (current() && version === generation) {
        saving.value = false;
        if (dirty.value && !error.value) timer = setTimeout(save, 200);
      }
    }
  }
  function changed(next) {
    state.value = snapshot(next); dirty.value = true; edit++;
    clearTimeout(timer); timer = setTimeout(save, 350);
  }
  function feedback(prompt = "") {
    if (!props.canFeedback || !data.value) return;
    emit("feedback", { id: selected.value, title: data.value.title, version: data.value.version,
      state: snapshot({ controls: state.value.controls || {}, widget: { modelContent: state.value.widget?.modelContent ?? null } }), prompt });
  }
  function receive(event) {
    const message = event.data;
    if (!current() || !frame.value || event.source !== frame.value.contentWindow || message?.channel !== channel ||
        message.token !== token || !data.value) return;
    try {
      if (message.type === "ready") {
        ready.value = true; clearTimeout(deadline);
        state.value = snapshot(message.state);
        if (Number.isSafeInteger(message.revision)) data.value.revision = message.revision;
        post("init", { writable: !readonly.value });
      } else if (message.type === "controls") controls.value = controlDescriptors(message.controls);
      else if (message.type === "resize" && Number.isFinite(message.height)) {
        height.value = Math.min(20000, Math.max(160, message.height));
        if (Number.isFinite(message.width) && message.width > 0) width.value = Math.min(10000, message.width);
      } else if (message.type === "escape" && props.active) emit("escape");
      else if (message.type === "state" && ready.value && !readonly.value) changed(message.state);
      else if (message.type === "feedback" && ready.value && props.canFeedback &&
          typeof message.prompt === "string" && message.prompt.trim() && message.prompt.length <= 12000) feedback(message.prompt);
      else if (message.type === "error") error.value = message.error === "state-size"
        ? "预览状态不能超过 16 KiB。" : "预览执行出错，可以引用当前版本反馈问题。";
    } catch (e) { error.value = e.message; }
  }
  function change(control, value) {
    if (!readonly.value) post("control", { id: control.id, value });
  }
  // Do not lose unsaved adjustments on version changes. An explicit reload is
  // the only operation that discards a conflicted draft.
  async function select(id) {
    if (dirty.value || saving.value) { error.value = "请先保存调整，或重新载入放弃未保存的调整。"; return; }
    selected.value = id; await load();
  }
  window.addEventListener("message", receive);
  watch(readonly, value => post("init", { writable: !value }));
  watch(() => props.latestVersion, async () => {
    if (!current() || !data.value) return;
    const version = generation;
    try {
      const result = await api(`/runs/${props.runKey}/previews/${selected.value}`);
      if (current() && version === generation) { data.value.versions = result.versions; data.value.latest = result.latest; }
    } catch (e) { if (current() && version === generation) error.value = e.message; }
  });
  onUnmounted(() => { alive = false; generation++; clearTimeout(timer); clearTimeout(deadline); window.removeEventListener("message", receive); });
  void load();
  return { selected, data, frame, src, loading, error, controls, height, width, ready, saving, dirty, conflict,
    readonly, state, load, save, select, post, change, feedback };
}
