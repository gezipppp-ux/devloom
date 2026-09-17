<script setup>
import { reactive, ref } from 'vue';
const props = defineProps({
  request: { type: Object, required: true },
  disabled: Boolean,
});
const emit = defineEmits(['respond']);
const answers = reactive({});
const formRef = ref();
const rules = Object.fromEntries(
  (props.request.params.questions || []).map((q) => [
    q.id,
    [{ required: true, whitespace: true, message: '请输入回答或选择选项' }],
  ]),
);
</script>
<template>
  <section class="request-panel">
    <div class="eyebrow">需要你的输入</div>
    <a-form
      v-if="request.method === 'item/tool/requestUserInput'"
      ref="formRef"
      :model="answers"
      :rules="rules"
      layout="vertical"
      @finish="
        emit('respond', { requestId: request.id, answers: { ...answers } })
      "
    >
      <a-form-item
        v-for="q in request.params.questions"
        :key="q.id"
        :name="q.id"
        :label="q.question"
        ><div class="answer-options">
          <button
            v-for="option in q.options || []"
            :key="option.label"
            type="button"
            :title="option.description"
            :class="{ selected: answers[q.id] === option.label }"
            @click="answers[q.id] = option.label"
          >
            {{ option.label }}
          </button>
        </div>
        <input
          v-model="answers[q.id]"
          :aria-label="q.question"
          :type="q.isSecret ? 'password' : 'text'"
          required
      /></a-form-item>
      <button class="primary" type="submit" :disabled="disabled">
        提交回答
      </button>
    </a-form>
    <template v-else
      ><h3>
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
      </div></template
    >
  </section>
</template>
