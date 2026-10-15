<script setup>
import AuthenticationLayout from "../../shared/components/AuthenticationLayout.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { onUnmounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { accountSession, loginAccount } from "../../shared/api/account-session.js";
const router = useRouter();
const route = useRoute();
const form = reactive({ username: "", password: "" });
const busy = ref(false), error = ref("");
let disposed = false;
onUnmounted(() => { disposed = true; form.password = ""; });
async function submit() {
  if (busy.value) return;
  busy.value = true; error.value = "";
  try {
    await loginAccount({ ...form });
    const redirect = typeof route.query.redirect === "string" && /^\/(?!\/)/.test(route.query.redirect) ? route.query.redirect : "/";
    await router.replace(accountSession.user?.mustChangePassword ? "/password" : redirect);
  } catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) { busy.value = false; form.password = ""; } }
}
</script>
<template>
  <AuthenticationLayout>
      <div class="eyebrow">DevLoom</div>
      <h1>{{ $t("登录工作台") }}</h1><p class="muted">{{ $t("使用管理员分配的账号，管理你的项目与开发会话。") }}</p>
      <a-form :model="form" layout="vertical" @finish="submit">
        <a-form-item :label="$t('账号')"><input v-model="form.username" :aria-label="$t('账号')" autocomplete="username" required maxlength="80" :disabled="busy" /></a-form-item>
        <a-form-item :label="$t('密码')"><input v-model="form.password" :aria-label="$t('密码')" type="password" autocomplete="current-password" required :disabled="busy" /></a-form-item>
        <FeedbackMessage :message="error || accountSession.error" type="error" />
        <button class="primary" type="submit" :disabled="busy || !form.username.trim() || !form.password">{{ busy ? $t("正在登录…") : $t("登录") }}</button>
      </a-form>
  </AuthenticationLayout>
</template>
