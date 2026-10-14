<script setup>
import { formatNumber } from "../i18n/index.js";
defineProps({ offset: { type: Number, default: 0 }, limit: { type: Number, default: 30 }, nextOffset: { type: Number, default: null }, total: { type: Number, default: null }, disabled: Boolean });
const emit = defineEmits(["change"]);
</script>
<template><nav v-if="offset || nextOffset != null || total" class="ui-pagination" :aria-label="$t(&quot;分页&quot;)"><span class="muted">{{ total == null ? '' : $t('共 {count} 项', { count: formatNumber(total) }) }}</span><div class="actions"><button :disabled="disabled || !offset" @click="emit('change', Math.max(0, offset - limit))">{{ $t("上一页") }}</button><span>{{ formatNumber(Math.floor(offset / limit) + 1) }}</span><button :disabled="disabled || nextOffset == null" @click="emit('change', nextOffset)">{{ $t("下一页") }}</button></div></nav></template>
