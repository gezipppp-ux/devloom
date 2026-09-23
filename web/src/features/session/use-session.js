import { computed, onUnmounted, ref } from "vue";
import { api } from "../../shared/api/api.js";

export function useSession({
  online,
  canRefresh,
  onOpen,
  onOpened,
  onItem,
  onMutation,
}) {
  const active = ref(null),
    session = ref(null),
    loading = ref(false),
    busy = ref(false),
    error = ref(""),
    notice = ref(""),
    settingsBusy = ref(false),
    settingsError = ref("");
  let pendingView,
    selection = 0,
    expandedHistory = false,
    executionEventRevision = 0;
  const running = computed(() => Boolean(session.value?.turnId));
  const initializing = computed(() => session.value?.status === "initializing");
  const executionSettings = computed(
    () =>
      session.value?.executionSettings || {
        model: session.value?.codex?.model || "",
        reasoningEffort: session.value?.codex?.reasoningEffort || "",
        permissionMode: "ask",
      },
  );
  const canEditSettings = computed(() =>
    Boolean(
      session.value?.sessionId &&
      !session.value.readOnlyReason &&
      !["preparing", "initializing", "starting"].includes(
        session.value.status,
      ) &&
      !loading.value &&
      online.value &&
      !settingsBusy.value,
    ),
  );
  const canSend = computed(
    () =>
      session.value &&
      !session.value.readOnlyReason &&
      !loading.value &&
      !busy.value &&
      !settingsBusy.value &&
      online.value &&
      !session.value.requests?.length,
  );

  function beginViewRequest(key) {
    // Retain SSE replacements while the canonical HTTP snapshot is pending.
    return (pendingView = { key, fields: {}, items: new Map() });
  }

  function mergeView(result, request, previous = []) {
    const items = new Map(previous.map((item) => [item.id, item]));
    for (const item of result.items) items.set(item.id, item);
    for (const [id, item] of request.items) items.set(id, item);
    return { ...result, ...request.fields, items: [...items.values()] };
  }

  function eventFields(event) {
    const fields = {};
    for (const name of [
      "status",
      "turnId",
      "sessionId",
      "requests",
      "error",
      "readOnlyReason",
      "executionSettings",
      "activeExecutionSettings",
      "settingsPending",
      "title",
    ])
      if (name in event) fields[name] = event[name];
    if (event.at) fields.lastActivity = event.at;
    return fields;
  }

  async function open(key) {
    const version = ++selection;
    expandedHistory = false;
    active.value = key;
    loading.value = true;
    busy.value = false;
    error.value = "";
    notice.value = "";
    settingsBusy.value = false;
    settingsError.value = "";
    session.value = null;
    onOpen();
    const request = beginViewRequest(key);
    try {
      const result = await api(`/runs/${key}`);
      if (pendingView === request) {
        session.value = mergeView(result, request);
        pendingView = null;
        await onOpened();
      }
    } catch (e) {
      if (version === selection) error.value = e.message;
    } finally {
      if (pendingView === request) pendingView = null;
      if (version === selection) loading.value = false;
    }
  }

  async function refresh() {
    if (!active.value || loading.value || !canRefresh()) return;
    const key = active.value;
    const request = beginViewRequest(key);
    try {
      const result = await api(`/runs/${key}`);
      if (pendingView !== request) return;
      session.value = {
        ...mergeView(result, request, session.value?.items || []),
        nextCursor: expandedHistory
          ? session.value.nextCursor
          : result.nextCursor,
      };
    } catch (e) {
      if (pendingView === request) throw e;
    } finally {
      if (pendingView === request) pendingView = null;
    }
  }

  function receiveEvent(event) {
    if (
      event.key === active.value &&
      ["executionSettings", "activeExecutionSettings", "settingsPending"].some(
        (name) => name in event,
      )
    )
      executionEventRevision++;
    const fields = eventFields(event);
    if (pendingView?.key === event.key) {
      Object.assign(pendingView.fields, fields);
      if (event.type === "item")
        pendingView.items.set(event.item.id, event.item);
    }
    if (event.key === active.value && session.value) {
      Object.assign(session.value, fields);
      if (event.type === "item") {
        const index = session.value.items.findIndex(
          (item) => item.id === event.item.id,
        );
        if (index < 0) session.value.items.push(event.item);
        else session.value.items[index] = event.item;
        onItem();
      }
      if (event.error) error.value = event.error;
      if (event.type === "notice") notice.value = event.text;
    }
  }

  function updateMetadata(key, metadata) {
    if (pendingView?.key === key) pendingView.fields.metadata = metadata;
    if (session.value?.key === key) session.value.metadata = metadata;
  }

  function updateTitle(key, title) {
    if (pendingView?.key === key) pendingView.fields.title = title;
    if (session.value?.key === key) session.value.title = title;
  }

  function remove(key) {
    if (pendingView?.key === key) pendingView = null;
    if (active.value === key) {
      selection++;
      active.value = null;
      session.value = null;
      loading.value = false;
      busy.value = false;
      onOpen();
    }
  }

  async function updateExecutionSettings(patch) {
    if (!canEditSettings.value) return;
    const key = active.value;
    const version = selection;
    const eventRevision = executionEventRevision;
    settingsBusy.value = true;
    settingsError.value = "";
    try {
      const result = await api(`/runs/${key}/execution-settings`, patch);
      if (version !== selection) return;
      // A peer's newer SSE selection must also win over a delayed save response.
      if (executionEventRevision === eventRevision) {
        const fields = {
          executionSettings: result.executionSettings,
          settingsPending: result.pending,
        };
        Object.assign(session.value, fields);
        if (pendingView?.key === key) Object.assign(pendingView.fields, fields);
      }
      onMutation();
    } catch (e) {
      if (version === selection) settingsError.value = e.message;
    } finally {
      if (version === selection) settingsBusy.value = false;
    }
  }

  async function action(route, data, after) {
    if (busy.value || !active.value) return;
    const key = active.value;
    const version = selection;
    busy.value = true;
    error.value = "";
    notice.value = "";
    try {
      await api(`/runs/${key}/${route}`, data);
      if (version === selection) await after?.();
      onMutation();
    } catch (e) {
      if (version === selection) error.value = e.message;
    } finally {
      if (version === selection) busy.value = false;
    }
  }

  async function older() {
    if (busy.value || !session.value?.nextCursor) return;
    expandedHistory = true;
    busy.value = true;
    const key = active.value;
    const version = selection;
    try {
      const result = await api(
        `/runs/${key}/history?${new URLSearchParams({ cursor: session.value.nextCursor })}`,
      );
      if (version === selection) {
        const items = new Map(
          [...result.items, ...session.value.items].map((item) => [
            item.id,
            item,
          ]),
        );
        session.value.items = [...items.values()];
        session.value.nextCursor = result.nextCursor;
      }
    } catch (e) {
      if (version === selection) error.value = e.message;
    } finally {
      if (version === selection) busy.value = false;
    }
  }

  onUnmounted(() => {
    selection++;
    pendingView = null;
  });

  return {
    active,
    session,
    loading,
    busy,
    error,
    notice,
    running,
    initializing,
    canSend,
    executionSettings,
    canEditSettings,
    settingsBusy,
    settingsError,
    updateExecutionSettings,
    open,
    refresh,
    receiveEvent,
    updateMetadata,
    updateTitle,
    remove,
    action,
    older,
  };
}
