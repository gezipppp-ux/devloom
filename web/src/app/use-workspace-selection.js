/* global window */
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { appApi, bootstrap, selectWorkspace } from "../shared/api/api.js";

export function useWorkspaceSelection() {
  const route = useRoute();
  const router = useRouter();
  const workspaces = ref([]),
    current = ref(null),
    ready = ref(false),
    error = ref(""),
    standalone = ref(false);
  let disposed = false;
  function navigationState() {
    return Object.fromEntries(Object.entries(window.history.state || {}).filter(([key]) =>
      !["back", "current", "forward", "replaced", "position", "scroll"].includes(key)));
  }

  async function navigate(id, task, { view = "", returnTo: requestedReturn = "" } = {}) {
    if (disposed) return;
    const location = route.fullPath;
    try {
      const result = await appApi("/bootstrap");
      if (disposed || route.fullPath !== location) return;
      workspaces.value = result.workspaces || [];
      const returnTo = requestedReturn || (route.name === "project" ? route.fullPath : route.query.returnTo);
      await router.push({ name: "workspace", query: { workspace: id, ...(task ? { task } : {}), ...(returnTo ? { returnTo } : {}), ...(["manual", "history"].includes(view) ? { view } : {}) }, state: navigationState() });
    } catch (failure) { if (!disposed) error.value = failure.message; }
  }

  function restoreSelection() {
    const requested = route.query.workspace;
    const selected = requested
      ? workspaces.value.find((entry) => entry.id === requested)
      : null;
    error.value =
      requested && !selected && !standalone.value
        ? "工作区不存在，请选择其他工作区。"
        : "";
    selectWorkspace(selected?.id || "");
    current.value = selected || null;
    if (selected && !requested) {
      void router.replace({ query: { ...route.query, workspace: selected.id }, hash: route.hash, state: navigationState() });
    }
  }

  function workspaceSaved(workspace, open = true) {
    workspaces.value = [
      ...workspaces.value.filter((entry) => entry.id !== workspace.id),
      workspace,
    ].sort((a, b) => a.name.localeCompare(b.name));
    if (current.value?.id === workspace.id) current.value = workspace;
    else if (open) navigate(workspace.id);
  }

  async function reload() {
    error.value = "";
    try {
      selectWorkspace("");
      const initial = await bootstrap();
      if (disposed) return;
      standalone.value = !initial.workspaces;
      workspaces.value = initial.workspaces || [];
      restoreSelection();
      ready.value = true;
    } catch (e) {
      if (!disposed) error.value = e.message;
    }
  }
  onMounted(reload);
  onUnmounted(() => {
    disposed = true;
    selectWorkspace("");
  });
  watch(() => route.query.workspace, () => { if (ready.value) restoreSelection(); });

  return { workspaces, current, ready, error, standalone, navigate, workspaceSaved, reload };
}
