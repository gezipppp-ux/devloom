<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';

const props = defineProps({
  request: { type: Object, required: true },
  disabled: Boolean,
  autoOpen: Boolean,
  agentLabel: { type: String, default: 'Agent' },
  error: { type: String, default: '' },
});
const emit = defineEmits(['respond']);
const dialog = ref(), trigger = ref(), validation = ref('');
const answers = reactive(Object.create(null));
const blocking = computed(() => props.request.blocking !== false);
function open() {
  if (!dialog.value || dialog.value.open) return;
  dialog.value.showModal();
  void nextTick(() => dialog.value?.querySelector('.question-field button, .question-field input, .question-field textarea')?.focus());
}
function close() {
  dialog.value?.close();
  trigger.value?.focus({ preventScroll: true });
}
function submit() {
  if (props.disabled) return;
  if (props.request.questions.some((question) => !answers[question.id]?.trim())) {
    validation.value = '请回答每个问题。';
    return;
  }
  validation.value = '';
  emit('respond', { requestId: props.request.id, answers: { ...answers } });
}
watch([dialog, () => props.autoOpen], () => {
  if (props.autoOpen && blocking.value) open();
}, { flush: 'post' });
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <section class="request-panel">
    <div class="eyebrow">{{ blocking ? $t("需要你的输入") : $t("有待回答的问题") }}</div>
    <p>{{ request.questions.map((question) => question.question).join('；') }}</p>
    <button ref="trigger" type="button" class="primary" @click="open">{{ $t("回答问题") }}</button>
    <Teleport to="body">
      <dialog ref="dialog" class="workspace-dialog session-question-dialog" :aria-label="$t(&quot;{p0} 的问题&quot;, { p0: agentLabel })" @cancel.prevent="close">
        <div class="workspace-dialog-heading">
          <h2>{{ agentLabel }} {{ $t("的问题") }}</h2>
          <button type="button" class="workspace-menu" :aria-label="$t(&quot;收起问题&quot;)" @click="close">×</button>
        </div>
        <p class="muted">{{ blocking ? $t('回答后 {agent} 将继续当前任务。', { agent: agentLabel }) : $t('{agent} 可以继续执行，你也可以随时补充回答。', { agent: agentLabel }) }}</p>
        <form @submit.prevent="submit">
          <fieldset v-for="(question, index) in request.questions" :key="question.id" class="question-field" :disabled="disabled">
            <legend><span v-if="question.header" class="question-header">{{ index + 1 }} · {{ question.header }}</span>{{ question.question }}</legend>
            <div v-if="question.options?.length" class="answer-options">
              <button v-for="option in question.options" :key="option.label" type="button"
                :aria-label="option.label" :aria-pressed="answers[question.id] === option.label"
                :class="{ selected: answers[question.id] === option.label }"
                @click="answers[question.id] = option.label">
                <strong>{{ option.label }}</strong><span>{{ option.description }}</span>
              </button>
            </div>
            <input v-if="question.isSecret" v-model="answers[question.id]" :aria-label="question.question" type="password" autocomplete="off" maxlength="20000" required />
            <textarea v-else v-model="answers[question.id]" :aria-label="question.question" rows="2" maxlength="20000" required :placeholder="$t(&quot;选择选项，或输入自己的回答&quot;)" />
          </fieldset>
          <p v-if="validation" class="error" role="alert">{{ $t(validation) }}</p>
          <FeedbackMessage :message="error" type="error" />
          <div class="actions">
            <button type="button" @click="close">{{ $t("稍后回答") }}</button>
            <button type="submit" class="primary" :disabled="disabled">{{ $t("提交回答") }}</button>
          </div>
        </form>
      </dialog>
    </Teleport>
  </section>
</template>
