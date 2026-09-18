/* global window */
import { onMounted, onUnmounted, ref } from "vue";
import { bootstrap, selectWorkspace } from "../shared/api/api.js";

export function useWorkspaceSelection() {
  const workspaces = ref([]),
    current = ref(null),
    ready = ref(false),
    error = ref(""),
    standalone = ref(false);
  let disposed = false;

  function navigate(id) {
    if (disposed || current.value?.id === id) return;
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", id);
    window.history.pushState(window.history.state, "", url.href);
    restoreSelection();
  }

  function restoreSelection() {
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("workspace");
    const selected = requested
      ? workspaces.value.find((entry) => entry.id === requested)
      : workspaces.value[0];
    error.value =
      requested && !selected && !standalone.value
        ? "工作区不存在，请选择其他工作区。"
        : "";
    selectWorkspace(selected?.id || "");
    current.value = selected || null;
    if (selected && !requested) {
      url.searchParams.set("workspace", selected.id);
      window.history.replaceState(window.history.state, "", url.href);
    }
  }

  function workspaceSaved(workspace) {
    workspaces.value = [
      ...workspaces.value.filter((entry) => entry.id !== workspace.id),
      workspace,
    ].sort((a, b) => a.name.localeCompare(b.name));
    if (current.value?.id === workspace.id) current.value = workspace;
    else navigate(workspace.id);
  }

  onMounted(async () => {
    try {
      const initial = await bootstrap();
      if (disposed) return;
      standalone.value = !initial.workspaces;
      workspaces.value = initial.workspaces || [];
      restoreSelection();
      window.addEventListener("popstate", restoreSelection);
      ready.value = true;
    } catch (e) {
      if (!disposed) error.value = e.message;
    }
  });
  onUnmounted(() => {
    disposed = true;
    window.removeEventListener("popstate", restoreSelection);
  });

  return { workspaces, current, ready, error, standalone, navigate, workspaceSaved };
}
