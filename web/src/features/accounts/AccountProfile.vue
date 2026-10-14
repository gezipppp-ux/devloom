<script setup>
import { onUnmounted, ref } from "vue";
import { accountSession, saveAccountProfile } from "../../shared/api/account-session.js";
import FormSection from "../../shared/components/FormSection.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";

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
  <FormSection class="account-profile-section" :title="$t(&quot;个人资料&quot;)">
    <form class="project-form" @submit.prevent="save">
      <div class="profile-identity"><PersonAvatar :name="accountSession.user.displayName" /><div><strong>{{ accountSession.user.displayName }}</strong><p>{{ accountSession.user.username }} · {{ $t("登录账号") }}</p></div></div>
      <label>{{ $t("显示名称") }}<input v-model="displayName" required maxlength="80" :disabled="busy" /></label>
      <p class="field-hint">{{ $t("显示名称用于成员、评论和负责人展示，登录账号保持不变。") }}</p>
      <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
      <div class="profile-save"><button type="submit" :disabled="busy || !displayName.trim()">{{ busy ? $t("正在保存…") : $t("保存显示名称") }}</button></div>
    </form>
  </FormSection>
</template>
<style scoped>
.profile-identity { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; min-width: 0; }
.profile-identity > div { min-width: 0; overflow-wrap: anywhere; }
.profile-identity strong { font-size: 15px; }
.profile-identity p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.account-profile-section :deep(.form-section-heading) { display: none; }
.profile-save { display: flex; justify-content: flex-end; margin-top: 16px; }
.project-form { max-width: none; gap: 0; }
.project-form > label { margin-bottom: 0; }
.project-form > .field-hint { margin: 8px 0 0; }
</style>
