<script setup>
import { onUnmounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createInitialAccount, revalidateAccountSession } from "../../shared/api/account-session.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import FormSection from "../../shared/components/FormSection.vue";

const route = useRoute(), router = useRouter();
const setupToken = ref(new URLSearchParams(route.hash.slice(1)).get("token") || "");
if (route.hash) void router.replace({ name: "setup", query: route.query, hash: "" });
const form = reactive({ username: "admin", displayName: "管理员", password: "", confirm: "" });
const busy = ref(false), error = ref("");
let disposed = false;
async function submit() {
  if (busy.value) return;
  if (form.password !== form.confirm) { error.value = "两次输入的密码不一致。"; return; }
  busy.value = true; error.value = "";
  try {
    await createInitialAccount({ username: form.username, displayName: form.displayName, password: form.password, setupToken: setupToken.value.trim() });
    setupToken.value = "";
  } catch (failure) {
    if (!disposed) error.value = `${failure.message} 若账号已创建，请使用该账号登录继续。`;
  } finally { form.password = ""; form.confirm = ""; if (!disposed) busy.value = false; }
}
async function login() {
  try { await revalidateAccountSession(); if (!disposed) await router.replace({ name: "login" }); }
  catch (failure) { if (!disposed) error.value = failure.message; }
}
onUnmounted(() => { disposed = true; form.password = ""; form.confirm = ""; setupToken.value = ""; });
</script>
<template>
  <div>
    <p class="notice">{{ $t("使用服务终端的一次性初始化链接创建管理员。创建后自动登录，并继续完成团队配置。") }}</p>
    <form @submit.prevent="submit">
      <FormSection :title="$t(&quot;管理员信息&quot;)">
        <label for="setup-token">{{ $t("初始化凭证") }}</label>
        <input id="setup-token" v-model="setupToken" type="password" autocomplete="off" required :disabled="busy" />
        <p class="field-hint">{{ $t("链接已携带凭证时会自动填入。凭证有效期 30 分钟；失效后在服务器运行 npm run setup:link 重新获取。") }}</p>
        <div class="admin-form-grid">
          <div><label for="setup-admin-username">{{ $t("登录名") }}</label><input id="setup-admin-username" v-model="form.username" autocomplete="username" required minlength="3" maxlength="64" pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,63}" :disabled="busy" /><p class="field-hint">{{ $t("3–64 位字母、数字、点、短横线或下划线。") }}</p></div>
          <div><label for="setup-admin-name">{{ $t("显示名称") }}</label><input id="setup-admin-name" v-model="form.displayName" required maxlength="80" :disabled="busy" /></div>
          <div><label for="setup-admin-password">{{ $t("设置密码") }}</label><input id="setup-admin-password" v-model="form.password" type="password" autocomplete="new-password" required minlength="6" maxlength="256" :disabled="busy" /><p class="field-hint">{{ $t("6–256 个字符，无预置密码。") }}</p></div>
          <div><label for="setup-admin-confirm">{{ $t("确认密码") }}</label><input id="setup-admin-confirm" v-model="form.confirm" type="password" autocomplete="new-password" required minlength="6" maxlength="256" :disabled="busy" /></div>
        </div>
      </FormSection>
      <FeedbackMessage :message="error" type="error" />
      <div class="actions"><button type="button" :disabled="busy" @click="login">{{ $t("已有账号，登录继续") }}</button><button class="primary" :disabled="busy" type="submit">{{ busy ? $t("正在创建管理员…") : $t("创建管理员并继续") }}</button></div>
    </form>
  </div>
</template>
<style scoped>
.admin-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 24px; }
.admin-form-grid > div { min-width: 0; }
label { display: block; margin-bottom: 8px; }
.actions { justify-content: flex-end; flex-wrap: wrap; }
@media (max-width: 600px) { .admin-form-grid { grid-template-columns: 1fr; } }
</style>
