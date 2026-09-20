<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import { api } from "../../shared/api/api.js";
import TapdSettings from "./TapdSettings.vue";
import PromptSettings from "./PromptSettings.vue";
import BaseRefSelect from "./BaseRefSelect.vue";
import FormSection from "../../shared/components/FormSection.vue";
const props = defineProps({
  workspaceName: { type: String, default: "" },
  canManageSystem: Boolean,
});
const emit = defineEmits(["saved", "rename-workspace", "system-settings"]);
const form = reactive({
  repository: "",
  worktreeRoot: "",
  baseRef: "HEAD",
});
const initCommandsText = ref("");
let disposed = false;
const savedSettings = ref(null);
const settings = computed(() => ({
  baseRef: form.baseRef,
  initCommands: initCommandsText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
}));
const dirty = computed(
  () =>
    savedSettings.value !== null &&
    JSON.stringify(settings.value) !== savedSettings.value,
);
const platform = ref(""),
  busy = ref(true),
  error = ref(""),
  saved = ref(false);
const rules = computed(() =>
  Object.fromEntries(
    ["baseRef"].map((key) => [
      key,
      [{ required: true, whitespace: true, message: "请填写此项" }],
    ]),
  ),
);
onMounted(async () => {
  try {
    const result = await api("/settings");
    if (disposed) return;
    for (const key of Object.keys(form)) form[key] = result[key] ?? "";
    platform.value = result.platform;
    initCommandsText.value = (result.initCommands || []).join("\n");
    savedSettings.value = JSON.stringify(settings.value);
  } catch (e) {
    if (!disposed) error.value = e.message;
  } finally {
    if (!disposed) busy.value = false;
  }
});
onUnmounted(() => {
  disposed = true;
});
async function save() {
  if (busy.value || !dirty.value) return;
  busy.value = true;
  error.value = "";
  saved.value = false;
  try {
    const result = await api("/settings", settings.value);
    if (disposed) return;
    initCommandsText.value = result.initCommands.join("\n");
    for (const key of Object.keys(form)) form[key] = result[key] ?? "";
    await nextTick();
    if (disposed) return;
    form.baseRef = result.baseRef;
    savedSettings.value = JSON.stringify(settings.value);
    saved.value = true;
    emit("saved");
  } catch (e) {
    if (!disposed) error.value = e.message;
  } finally {
    if (!disposed) busy.value = false;
  }
}
</script>

<template>
  <section class="start-panel">
    <header class="page-heading">
      <div class="eyebrow">EXECUTION SETTINGS</div>
      <h1>
        {{
          props.workspaceName
            ? `${props.workspaceName} · 工作区设置`
            : "配置开发工作区。"
        }}
      </h1>
      <p>
        路径属于运行服务的
        {{
          platform === "win32"
            ? "Windows"
            : platform === "linux"
              ? "Linux"
              : platform || "主机"
        }}。保存后用于新建任务，已有 session 继续使用原来的 worktree。
      </p>
    </header>
    <nav v-if="props.workspaceName" class="section-nav" aria-label="设置分区">
      <a href="#workspace-settings">基本信息</a>
      <a href="#project-settings">项目环境</a>
      <a href="#tapd-settings">TAPD 渠道</a>
      <a href="#prompt-settings">提示词模板</a>
    </nav>
    <FormSection
      v-if="props.workspaceName"
      id="workspace-settings"
      title="基本信息"
      description="修改工作区名称和图标。"
    >
      <template #action>
        <button type="button" @click="emit('rename-workspace')">重命名</button>
      </template>
      <dl class="workspace-profile">
        <dt>工作区名称</dt>
        <dd>{{ props.workspaceName }}</dd>
      </dl>
    </FormSection>
    <FormSection
      id="project-settings"
      title="项目环境"
      description="项目仓库和任务目录由创建工作区时的 Git 地址自动生成，不能在这里修改。"
    >
      <a-form :model="form" :rules="rules" layout="vertical" @finish="save">
        <dl class="workspace-profile">
          <dt>项目代码仓库</dt>
          <dd>
            <code aria-label="项目代码仓库路径">{{
              form.repository || (busy ? "正在加载…" : "未加载")
            }}</code>
          </dd>
          <dt>工作区 Worktree 目录</dt>
          <dd>
            <code aria-label="工作区 Worktree 完整路径">{{
              form.worktreeRoot || "未加载"
            }}</code>
          </dd>
        </dl>
        <p class="field-hint">
          新任务会在上方 Worktree 目录下创建一层任务目录；路径由 Git
          项目自动确定。
        </p>
        <a-form-item label="新任务基准引用" name="baseRef">
          <BaseRefSelect
            v-model="form.baseRef"
            :repository="form.repository"
            :disabled="busy"
          />
        </a-form-item>
        <p class="field-hint">
          可搜索本地分支、已获取的远程分支和标签，也可输入 commit
          SHA。列表只读取当前工作区的仓库，不会执行远端获取。
        </p>
        <a-form-item label="Worktree 初始化命令（可选）">
          <textarea
            v-model="initCommandsText"
            aria-label="Worktree 初始化命令"
            rows="5"
            :disabled="busy"
            placeholder="pnpm install&#10;pnpm build"
          />
        </a-form-item>
        <p class="field-hint">
          每行一条，最多 20 条。新建 worktree 后按顺序执行，每条从 worktree
          根目录开始； Windows 使用 cmd，Linux 使用 sh。全部成功后才启动
          Codex，失败或单条超过 15 分钟即停止。
          留空跳过初始化，保存仅影响新任务。
        </p>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <p v-if="saved && !dirty" role="status" class="notice">
          设置已保存，新任务将使用此配置。
        </p>
        <div class="actions">
          <button class="primary" type="submit" :disabled="busy || !dirty">
            {{ busy ? "正在处理…" : "保存执行设置" }}
          </button>
        </div>
      </a-form>
    </FormSection>
    <TapdSettings v-if="props.workspaceName" @saved="emit('saved')" />
    <PromptSettings v-if="props.workspaceName" />
  </section>
</template>
