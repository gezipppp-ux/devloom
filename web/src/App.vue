<script setup>
/* global window */
import { onMounted, ref } from "vue";
import { bootstrap, selectWorkspace } from "./api";
import WorkspaceConsole from "./WorkspaceConsole.vue";
import WorkspacePicker from "./WorkspacePicker.vue";
const workspaces = ref([]),
  current = ref(null),
  ready = ref(false),
  error = ref("");
const standalone = ref(false);
const picker = ref();
function navigate(id) {
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", id);
  window.location.assign(url.href);
}
onMounted(async () => {
  try {
    const initial = await bootstrap();
    standalone.value = !initial.workspaces;
    workspaces.value = initial.workspaces || [];
    const requested = new URL(window.location.href).searchParams.get(
      "workspace",
    );
    current.value = requested
      ? workspaces.value.find((entry) => entry.id === requested)
      : workspaces.value[0];
    if (requested && !current.value && !standalone.value)
      error.value = "工作区不存在，请选择其他工作区。";
    if (current.value) selectWorkspace(current.value.id);
    ready.value = true;
  } catch (e) {
    error.value = e.message;
  }
});
</script>

<template>
  <WorkspaceConsole
    v-if="ready && (current || standalone)"
    :workspace-name="current?.name || ''"
    @rename-workspace="picker?.edit(true)"
  >
    <template v-if="!standalone" #workspace-rail>
      <WorkspacePicker
        ref="picker"
        rail
        :workspaces="workspaces"
        :current="current"
        @select="navigate"
      />
    </template>
  </WorkspaceConsole>
  <section v-else class="workspace-welcome">
    <div class="welcome-mark" aria-hidden="true">t_</div>
    <div class="eyebrow">需求 × CODEX</div>
    <h1>{{ ready ? "创建或选择工作区" : "正在连接工作台…" }}</h1>
    <p class="welcome-description">
      一个项目，一套配置。独立管理需求与开发会话。
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <WorkspacePicker v-if="ready" :workspaces="workspaces" @select="navigate" />
  </section>
</template>
