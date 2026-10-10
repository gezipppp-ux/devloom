<script setup>
import SessionQuestions from './SessionQuestions.vue';
defineProps({
  request: { type: Object, required: true },
  disabled: Boolean,
  autoOpen: Boolean,
  error: { type: String, default: '' },
});
const emit = defineEmits(['respond']);
</script>
<template>
  <SessionQuestions v-if="request.method === 'item/tool/requestUserInput'" :request="request" :disabled="disabled" :auto-open="autoOpen" :error="error" @respond="emit('respond', $event)" />
  <section v-else class="request-panel">
    <div class="eyebrow">需要你的输入</div>
    <h3>
        {{
          request.method.includes('commandExecution')
            ? 'Codex 请求执行命令'
            : 'Codex 请求修改文件'
        }}
      </h3>
      <p>{{ request.params.reason }}</p>
      <pre>{{
        request.params.command ||
        request.params.grantRoot ||
        '请查看本轮工具记录中的操作详情。'
      }}</pre>
      <div class="actions">
        <button
          :disabled="disabled"
          @click="
            emit('respond', { requestId: request.id, decision: 'decline' })
          "
        >
          拒绝</button
        ><button
          class="primary"
          :disabled="disabled"
          @click="
            emit('respond', { requestId: request.id, decision: 'accept' })
          "
        >
          允许本次操作
        </button>
      </div>
  </section>
</template>
