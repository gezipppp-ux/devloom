<script setup>
import { nextTick, onMounted, reactive, ref } from "vue";
import { api } from "../../shared/api/api.js";
import TapdSettings from "./TapdSettings.vue";
import BaseRefSelect from "./BaseRefSelect.vue";
import FormSection from "../../shared/components/FormSection.vue";
const props = defineProps({ workspaceName: { type: String, default: "" } });
const emit = defineEmits(["cancel", "saved"]);
const form = reactive({
  repository: "",
  worktreeRoot: "",
  baseRef: "HEAD",
});
const initCommandsText = ref("");
const platform = ref(""),
  busy = ref(true),
  error = ref(""),
  saved = ref(false);
const rules = Object.fromEntries(
  Object.keys(form).map((key) => [
    key,
    [{ required: true, whitespace: true, message: "请填写此项" }],
  ]),
);
onMounted(async () => {
  try {
    const result = await api("/settings");
    for (const key of Object.keys(form)) form[key] = result[key] ?? "";
    platform.value = result.platform;
    initCommandsText.value = (result.initCommands || []).join("\n");
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
});
async function save() {
  busy.value = true;
  error.value = "";
  saved.value = false;
  try {
    const result = await api("/settings", {
      ...form,
      initCommands: initCommandsText.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    });
    initCommandsText.value = result.initCommands.join("\n");
    for (const key of Object.keys(form)) form[key] = result[key] ?? "";
    await nextTick();
    form.baseRef = result.baseRef;
    saved.value = true;
    emit("saved");
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
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
      <a href="#project-settings">项目环境</a>
      <a href="#tapd-settings">TAPD 渠道</a>
    </nav>
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
                ? 'D:\Projects\my-project'
                : '/srv/repos/my-project'
            "
            required
        /></a-form-item>
        <p class="field-hint">
          选择此工作区对应的 Git 仓库根目录，所有渠道任务都使用这个项目。
        </p>
        <a-form-item label="Worktree 根目录" name="worktreeRoot"
          ><input
            v-model="form.worktreeRoot"
            aria-label="Worktree 根目录"
            :placeholder="
              platform === 'win32' ? 'E:\CodexWorktrees' : '/srv/worktrees'
            "
            required
        /></a-form-item>
        <p class="field-hint">
          可选择独立磁盘或目录，服务会在其下按仓库与需求创建子目录，目录需要当前服务用户可写。
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
        <p v-if="saved" role="status" class="notice">
          设置已保存，新任务将使用此配置。
        </p>
        <div class="actions">
          <button type="button" @click="emit('cancel')">返回会话</button
          ><button class="primary" type="submit" :disabled="busy">
            {{ busy ? "正在处理…" : "保存执行设置" }}
          </button>
        </div>
      </a-form>
    </FormSection>
    <TapdSettings v-if="props.workspaceName" @saved="emit('saved')" />
  </section>
</template>
