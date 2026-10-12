<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { showMessage } from "../../shared/components/operation-messages.js";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import { api } from "../../shared/api/api.js";
import TapdSettings from "./TapdSettings.vue";
import PromptSettings from "./PromptSettings.vue";
import BaseBranchSelect from "./BaseBranchSelect.vue";
import FormSection from "../../shared/components/FormSection.vue";
const props = defineProps({
  workspaceName: { type: String, default: "" },
  canManageSystem: Boolean,
});
const emit = defineEmits(["saved", "rename-workspace", "system-settings"]);
const form = reactive({
  repository: "",
  worktreeRoot: "",
  baseBranch: "",
});
const initCommandsText = ref("");
let disposed = false;
const savedSettings = ref(null);
const settings = computed(() => ({
  baseBranch: form.baseBranch,
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
  error = ref("");
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

  try {
    const result = await api("/settings", settings.value);
    if (disposed) return;
    initCommandsText.value = result.initCommands.join("\n");
    for (const key of Object.keys(form)) form[key] = result[key] ?? "";
    await nextTick();
    if (disposed) return;
    form.baseBranch = result.baseBranch;
    savedSettings.value = JSON.stringify(settings.value);
    showMessage("设置已保存，新任务将使用此配置。", "success");
    emit("saved");
  } catch (e) {
    if (!disposed) error.value = e.message;
  } finally {
    if (!disposed) busy.value = false;
  }
}
</script>

<template>
  <section class="page-layout">
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
    <nav v-if="props.workspaceName" class="page-tabs" aria-label="设置分区">
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
      <a-form :model="form"  layout="vertical" @finish="save">
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
        <a-form-item label="新任务开发分支" name="baseBranch">
          <BaseBranchSelect
            v-model="form.baseBranch"
            :repository="form.repository"
            :disabled="busy"
          />
        </a-form-item>
        <p class="field-hint">
          可搜索已获取的 origin 分支，也可输入尚未获取的远端短分支名。
          留空表示尚未配置；新建工作树前会获取并验证所选分支的最新代码。
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
        <FeedbackMessage :message="error" type="error" />

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
