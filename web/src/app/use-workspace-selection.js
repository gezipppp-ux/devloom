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
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", id);
    window.location.assign(url.href);
  }

  onMounted(async () => {
    try {
      const initial = await bootstrap();
      if (disposed) return;
      standalone.value = !initial.workspaces;
      workspaces.value = initial.workspaces || [];
      const url = new URL(window.location.href);
      const requested = url.searchParams.get("workspace");
      current.value = requested
        ? workspaces.value.find((entry) => entry.id === requested)
        : workspaces.value[0];
      if (requested && !current.value && !standalone.value)
        error.value = "工作区不存在，请选择其他工作区。";
      if (current.value) {
        selectWorkspace(current.value.id);
        if (!requested) {
          url.searchParams.set("workspace", current.value.id);
          window.history.replaceState(window.history.state, "", url.href);
        }
      }
      ready.value = true;
    } catch (e) {
      if (!disposed) error.value = e.message;
    }
  });
  onUnmounted(() => {
    disposed = true;
  });

  return { workspaces, current, ready, error, standalone, navigate };
}
