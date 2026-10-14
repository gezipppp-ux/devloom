<script setup>
import SessionQuestions from './SessionQuestions.vue';
defineProps({
  request: { type: Object, required: true },
  disabled: Boolean,
  autoOpen: Boolean,
  agentLabel: { type: String, default: 'Agent' },
  error: { type: String, default: '' },
});
const emit = defineEmits(['respond']);
</script>
<template>
  <SessionQuestions v-if="request.kind === 'user-input'" :request="request" :agent-label="agentLabel" :disabled="disabled" :auto-open="autoOpen" :error="error" @respond="emit('respond', $event)" />
  <section v-else-if="request.kind === 'approval' && ['command', 'file-change'].includes(request.action)" class="request-panel">
    <div class="eyebrow">{{ $t("需要你的输入") }}</div>
    <h3>
        {{
          request.action === 'command'
            ? $t('{agent} 请求执行命令', { agent: agentLabel })
            : $t('{agent} 请求修改文件', { agent: agentLabel })
        }}
      </h3>
      <p>{{ request.reason }}</p>
      <pre>{{
        request.command ||
        request.grantRoot ||
        $t("请查看本轮工具记录中的操作详情。")
      }}</pre>
      <div class="actions">
        <button
          :disabled="disabled"
          @click="
            emit('respond', { requestId: request.id, decision: 'decline' })
          "
        >
          {{ $t("拒绝") }}</button
        ><button
          class="primary"
          :disabled="disabled"
          @click="
            emit('respond', { requestId: request.id, decision: 'accept' })
          "
        >
          {{ $t("允许本次操作") }}
        </button>
      </div>
  </section>
  <section v-else class="request-panel" role="alert">
    <h3>{{ $t("暂不支持此交互请求") }}</h3>
    <p>{{ $t("无法通过当前界面处理，请查看会话状态或停止当前一轮。") }}</p>
  </section>
</template>

<style scoped>
.request-panel { padding: 18px; margin: 16px 0 24px 43px; border: 1px solid var(--field-border); border-radius: 9px; background: var(--surface-hover); box-shadow: none; }
.request-panel .eyebrow { color: var(--highlight); }
.request-panel h3 { font-size: 14px; margin: 8px 0 10px; }
.request-panel .actions { margin-top: 16px; gap: 10px; flex-wrap: wrap; }
@media (max-width: 767px) { .request-panel { margin-left: 0; padding: 16px; } }
</style>
