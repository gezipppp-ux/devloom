<script setup>
import { computed } from "vue";
import { ReloadOutlined } from "@antdv-next/icons";
import AppSelect from "./AppSelect.vue";
import { translate } from "../i18n/index.js";
const props = defineProps({
  modelValue: { type: String, default: "ask" },
  options: { type: Array, default: () => [] },
  disabled: Boolean,
  compact: Boolean,
  refreshable: Boolean,
  refreshing: Boolean,
});
const emit = defineEmits(["update:modelValue", "refresh"]);
const choices = computed(() =>
  props.options.map((option) => ({
    value: option.id,
    label: translate(option.label),
    description: [
      translate(option.description),
      !option.available && translate(option.reason || "当前服务不可用"),
    ]
      .filter(Boolean)
      .join(" "),
    disabled: !option.available,
  })),
);
</script>
<template>
  <AppSelect
    class="permission-selector"
    :class="{ 'permission-selector-compact': compact }"
    :value="modelValue"
    :options="choices"
    :disabled="disabled"
    :toolbar="compact"
    :aria-label="$t('权限模式')"
    @change="emit('update:modelValue', $event)"
  >
    <template v-if="refreshable" #footer
      ><button
        type="button"
        class="text-button permission-refresh"
        :disabled="disabled || refreshing"
        @click="emit('refresh')"
      >
        <ReloadOutlined aria-hidden="true" />{{
          refreshing ? $t("正在刷新权限选项…") : $t("刷新权限选项")
        }}
      </button></template
    >
  </AppSelect>
</template>
