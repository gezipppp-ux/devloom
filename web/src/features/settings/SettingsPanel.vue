<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import { api } from "../../shared/api/api.js";
import TapdSettings from "./TapdSettings.vue";
import PromptSettings from "./PromptSettings.vue";
import BaseRefSelect from "./BaseRefSelect.vue";
import FormSection from "../../shared/components/FormSection.vue";
const props = defineProps({ workspaceName: { type: String, default: "" } });
const emit = defineEmits(["saved", "rename-workspace", "system-settings"]);
const form = reactive({
  repository: "",
  worktreeRoot: "",
  worktreeDirectory: "",
  baseRef: "HEAD",
});
const initCommandsText = ref("");
const worktreeBasePath = ref("");
let disposed = false;
const savedSettings = ref(null);
const settings = computed(() => ({
  repository: form.repository,
  ...(props.workspaceName
    ? { worktreeDirectory: form.worktreeDirectory }
    : { worktreeRoot: form.worktreeRoot }),
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
const worktreePreview = computed(() => {
  if (
    !worktreeBasePath.value ||
    !form.worktreeDirectory.trim() ||
    directoryError.value
  )
    return "";
  const separator = platform.value === "win32" ? "\\" : "/";
  return (
    worktreeBasePath.value.replace(/[\\/]+$/, "") +
    separator +
    form.worktreeDirectory.trim().split(/[\\/]/).join(separator)
  );
});
const directoryError = computed(() => {
  const value = form.worktreeDirectory;
  if (!value || !props.workspaceName) return "";
  if (value.length > 240) return "工作区 Worktree 目录最多 240 个字符。";
  if (/^[\\/]|^[a-z]:/i.test(value))
    return "请填写基础目录下的相对目录，不要填写绝对路径。";
  const parts = value.split(/[\\/]/);
  if (parts.some((part) => !part || part === "." || part === ".."))
    return "目录不能包含空层级、. 或 ..，也不能以路径分隔符开头或结尾。";
  if (
    parts.some(
      (part) =>
        part !== part.trim() ||
        /[<>:\"|?*\u0000-\u001f\u007f]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part),
    )
  )
    return "目录名称不能包含非法字符、Windows 设备名、首尾空格，或以句点结尾。";
  return "";
});
const rules = computed(() =>
  Object.fromEntries(
    [
      "repository",
      "baseRef",
      props.workspaceName ? "worktreeDirectory" : "worktreeRoot",
    ].map((key) => [
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
    worktreeBasePath.value = result.worktreeBasePath || "";
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
  if (busy.value || !dirty.value || directoryError.value) return;
  busy.value = true;
  error.value = "";
  saved.value = false;
  try {
    const result = await api("/settings", settings.value);
    if (disposed) return;
    initCommandsText.value = result.initCommands.join("\n");
    for (const key of Object.keys(form)) form[key] = result[key] ?? "";
    worktreeBasePath.value = result.worktreeBasePath || "";
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
      description="配置代码仓库与独立开发目录。"
    >
      <a-form :model="form" :rules="rules" layout="vertical" @finish="save">
        <a-form-item label="项目代码仓库" name="repository"
          ><input
            v-model="form.repository"
            aria-label="项目代码仓库"
            :placeholder="
              platform === 'win32'
                ? 'D:\\Projects\\my-project'
                : '/srv/repos/my-project'
            "
            required
        /></a-form-item>
        <p class="field-hint">
          选择此工作区对应的 Git 仓库根目录，所有渠道任务都使用这个项目。
        </p>
        <template v-if="props.workspaceName">
          <div class="worktree-base-summary">
            <div>
              <span>系统 Worktree 基础目录</span
              ><code>{{
                worktreeBasePath || (busy ? "正在加载…" : "未加载基础目录")
              }}</code>
            </div>
            <button
              type="button"
              class="text-button"
              @click="emit('system-settings')"
            >
              前往系统设置
            </button>
          </div>
          <a-form-item label="工作区 Worktree 目录" name="worktreeDirectory">
            <input
              v-model="form.worktreeDirectory"
              aria-label="工作区 Worktree 目录"
              placeholder="例如：project-a"
              :aria-invalid="Boolean(directoryError)"
              aria-describedby="worktree-directory-hint"
              required
            />
          </a-form-item>
          <p id="worktree-directory-hint" class="field-hint">
            填写基础目录下的相对目录，可用 /
            分隔多级目录，建议使用简短名称。系统自动补充分隔符；不支持绝对路径、.. 或非法目录名。
          </p>
          <p v-if="directoryError" class="error" role="alert">
            {{ directoryError }}
          </p>
          <div class="worktree-path-preview">
            <span>工作区 Worktree 完整路径</span>
            <output aria-label="工作区 Worktree 完整路径">{{
              worktreePreview || "填写有效的工作区目录后显示完整路径"
            }}</output>
            <p>
              每个任务仅在此路径下创建一层短目录，由前缀与短标识组成，例如 ce-shi-a1b2c3d4e5f6。
            </p>
          </div>
        </template>
        <a-form-item v-else label="Worktree 根目录" name="worktreeRoot"
          ><input
            v-model="form.worktreeRoot"
            aria-label="Worktree 根目录"
            :placeholder="
              platform === 'win32' ? 'D:\\wt' : '/srv/wt'
            "
            required
        /></a-form-item>
        <p v-if="!props.workspaceName" class="field-hint">
          建议选择简短且当前服务用户可写的路径。每个任务在其下创建一层短目录，例如 ce-shi-a1b2c3d4e5f6。
        </p>
        <a-form-item label="新任务基准引用" name="baseRef">
          <BaseRefSelect v-model="form.baseRef" :repository="form.repository" />
        </a-form-item>
        <p class="field-hint">
          可搜索本地分支、已获取的远程分支和标签，也可输入 commit
          SHA。切换仓库后恢复为 HEAD。
        </p>
        <a-form-item label="Worktree 初始化命令（可选）">
          <textarea
            v-model="initCommandsText"
            aria-label="Worktree 初始化命令"
            rows="5"
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
          <button
            class="primary"
            type="submit"
            :disabled="busy || !dirty || Boolean(directoryError)"
          >
            {{ busy ? "正在处理…" : "保存执行设置" }}
          </button>
        </div>
      </a-form>
    </FormSection>
    <TapdSettings v-if="props.workspaceName" @saved="emit('saved')" />
    <PromptSettings v-if="props.workspaceName" />
  </section>
</template>
