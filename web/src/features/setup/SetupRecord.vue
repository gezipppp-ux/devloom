<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import SetupSummary from "./SetupSummary.vue";
defineEmits(["continue"]);
const state = ref(null), error = ref(""), loading = ref(false);
let disposed = false;
async function load() {
  loading.value = true; error.value = "";
  try { const result = await appApi("/system/setup"); if (!disposed) state.value = result; }
  catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) loading.value = false; }
}
onMounted(load); onUnmounted(() => { disposed = true; });
</script>
<template>
  <p v-if="loading" role="status">{{ $t("正在读取初始化记录…") }}</p>
  <FeedbackMessage :message="error" type="error" />
  <button v-if="error" :disabled="loading" @click="load">{{ $t("重新加载") }}</button>
  <template v-if="state"><p v-if="state.status === 'not_required'" class="notice">{{ $t("此部署已有业务配置，无需运行首次初始化向导。可通过账号、部门及项目管理调整配置。") }}</p><template v-else><p class="muted">{{ state.status === 'completed' ? $t("初始化已完成，以下为已保存的配置记录。") : $t("初始化尚未完成，请继续剩余步骤。") }}</p><SetupSummary :state="state" /><button v-if="state.status === 'pending'" class="primary" @click="$emit('continue')">{{ $t("继续初始化") }}</button></template></template>
</template>
