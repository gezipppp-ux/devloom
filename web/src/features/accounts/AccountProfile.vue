<script setup>
import { onUnmounted, ref } from "vue";
import { accountSession, saveAccountProfile } from "../../shared/api/account-session.js";
import FormSection from "../../shared/components/FormSection.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";

const displayName = ref(accountSession.user.displayName);
const busy = ref(false), error = ref(""), notice = ref("");
let disposed = false;
onUnmounted(() => { disposed = true; });
async function save() {
  if (busy.value || !displayName.value.trim()) return;
  busy.value = true; error.value = ""; notice.value = "";
  try {
    const user = await saveAccountProfile({ displayName: displayName.value.trim() });
    if (disposed) return;
    displayName.value = user.displayName;
    notice.value = "显示名称已保存。";
  } catch (failure) { if (!disposed && failure.name !== "AbortError") error.value = failure.message; }
  finally { if (!disposed) busy.value = false; }
}
</script>
<template>
  <FormSection :title="$t(&quot;个人资料&quot;)" :description="$t(&quot;显示名称用于成员、评论和负责人展示，登录账号保持不变。&quot;)">
    <form class="project-form" @submit.prevent="save">
      <label>{{ $t("登录账号") }}<input :value="accountSession.user.username" readonly /></label>
      <label>{{ $t("显示名称") }}<input v-model="displayName" required maxlength="80" :disabled="busy" /></label>
      <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
      <button type="submit" class="primary" :disabled="busy || !displayName.trim()">{{ busy ? $t("正在保存…") : $t("保存显示名称") }}</button>
    </form>
  </FormSection>
</template>
