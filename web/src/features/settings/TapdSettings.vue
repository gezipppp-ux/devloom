<script setup>
import { onMounted, reactive, ref } from "vue";
import { api } from "../../shared/api/api.js";
import FormSection from "../../shared/components/FormSection.vue";
const emit = defineEmits(["saved"]);
const form = reactive({
  workspaceId: "",
  cookie: "",
  clearCookie: false,
});
const hosts = ref(""),
  hasCookie = ref(false),
  busy = ref(true),
  message = ref(""),
  error = ref("");
onMounted(async () => {
  try {
    const result = await api("/settings/tapd");
    form.workspaceId = result.workspaceId;
    hosts.value = result.imageHosts.join("\n");
    hasCookie.value = result.hasCookie;
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
});
async function submit(check) {
  busy.value = true;
  message.value = error.value = "";
  try {
    const result = await api(`/settings/tapd${check ? "/check" : ""}`, {
      ...form,
      imageHosts: hosts.value.split(/\s+/).filter(Boolean),
    });
    if (check) message.value = result.message;
    else {
      hasCookie.value = result.hasCookie;
      form.cookie = "";
      form.clearCookie = false;
      message.value = "TAPD 配置已保存。";
      emit("saved");
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <FormSection
    id="tapd-settings"
    class="channel-settings"
    title="TAPD 渠道"
    description="每个工作区绑定一个 TAPD 项目；手动需求无需配置。"
  >
    <template #action
      ><span class="config-badge" :class="{ configured: hasCookie }">{{
        hasCookie ? "已配置 Cookie" : "未配置 Cookie"
      }}</span></template
    >
    <form @submit.prevent="submit(false)">
      <label
        >TAPD 项目 ID<input
          v-model="form.workspaceId"
          aria-label="TAPD 项目 ID"
          inputmode="numeric"
          required
          :disabled="busy"
      /></label>
      <label
        >TAPD Cookie<textarea
          v-model="form.cookie"
          aria-label="TAPD Cookie"
          rows="3"
          maxlength="32000"
          autocomplete="off"
          :disabled="busy || form.clearCookie"
          :placeholder="
            hasCookie
              ? '已保存 Cookie；留空保留，粘贴新值替换'
              : '粘贴包含 dsc-token 的完整 Cookie'
          "
        />
      </label>
      <p class="field-hint">
        {{
          hasCookie ? "已保存 Cookie，页面不会回显。" : "尚未配置 Cookie。"
        }}检测使用当前输入；留空时检测已保存的 Cookie，不会启动任务或修改需求。
      </p>
      <label v-if="hasCookie" class="checkbox-label"
        ><input
          v-model="form.clearCookie"
          type="checkbox"
          :disabled="busy"
        />清除已保存的 Cookie</label
      >
      <p class="field-hint">检索 TAPD 全部待办，启动任务不会自动修改 TAPD 状态。</p>
      <label
        >额外图片域名（可选，每行一个）<textarea
          v-model="hosts"
          aria-label="额外图片域名"
          rows="2"
          :disabled="busy"
          placeholder="cdn.example.com"
        />
      </label>
      <p class="field-hint">
        允许下载需求中的外部图片；填写完整域名，无需填写协议和路径。
      </p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="message" class="notice" role="status">{{ message }}</p>
      <div class="actions">
        <button
          type="button"
          :disabled="busy || !form.workspaceId || form.clearCookie"
          @click="submit(true)"
        >
          {{ busy ? "正在处理…" : "检测连接" }}
        </button>
        <button
          type="submit"
          class="primary"
          :disabled="busy || !form.workspaceId"
        >
          保存 TAPD 配置
        </button>
      </div>
    </form>
  </FormSection>
</template>
