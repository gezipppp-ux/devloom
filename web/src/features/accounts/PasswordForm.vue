<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { showMessage } from "../../shared/components/operation-messages.js";
import { onUnmounted, reactive, ref } from "vue";
import { changeAccountPassword } from "../../shared/api/account-session.js";
const emit = defineEmits(["saved"]);
const form = reactive({ currentPassword: "", password: "", confirmation: "" });
const busy = ref(false), error = ref("");
let disposed = false;
onUnmounted(() => { disposed = true; form.currentPassword = ""; form.password = ""; form.confirmation = ""; });
async function save() {
  if (busy.value) return;
  error.value = "";
  if (form.password !== form.confirmation) { error.value = "两次输入的新密码不一致。"; return; }
  busy.value = true;
  try {
    await changeAccountPassword({ currentPassword: form.currentPassword, password: form.password });
    if (!disposed) { form.currentPassword = ""; form.password = ""; form.confirmation = ""; showMessage("密码已更新。", "success"); emit("saved"); }
  } catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) busy.value = false; }
}
</script>
<template>
  <a-form :model="form" layout="vertical" @finish="save">
    <a-form-item :label="$t('当前密码')"><input v-model="form.currentPassword" type="password" autocomplete="current-password" :aria-label="$t('当前密码')" required :disabled="busy" /></a-form-item>
    <a-form-item :label="$t('新密码')"><input v-model="form.password" type="password" autocomplete="new-password" :aria-label="$t('新密码')" required minlength="6" :disabled="busy" /><p class="field-hint">{{ $t("至少 6 个字符。") }}</p></a-form-item>
    <a-form-item :label="$t('确认新密码')"><input v-model="form.confirmation" type="password" autocomplete="new-password" :aria-label="$t('确认新密码')" required minlength="6" :disabled="busy" /></a-form-item>
    <FeedbackMessage :message="error" type="error" />
    <button class="primary" type="submit" :disabled="busy">{{ busy ? $t("正在保存…") : $t("修改密码") }}</button>
  </a-form>
</template>
