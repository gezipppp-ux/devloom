<script setup>
import { formatDate } from "../../shared/i18n/index.js";
import { computed } from "vue";
import { FileTextOutlined, CheckSquareOutlined, CodeOutlined, InboxOutlined } from "@antdv-next/icons";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
const props = defineProps({ items: { type: Array, default: () => [] }, people: { type: Array, default: () => [] }, kind: { type: String, default: "issues" } });
const emit = defineEmits(["open"]);
const names = computed(() => Object.fromEntries(props.people.map(person => [person.id, person.displayName])));
const person = item => names.value[item.developerId || item.authorId || item.executorId];
</script>
<template>
  <ul class="ui-work-list"><li v-for="item in items" :key="item.id"><button class="ui-work-row" @click="emit('open', item)"><span class="ui-work-symbol" :class="{ 'ui-work-symbol-bug': item.type === 'bug' }"><component :is="kind === 'deliveries' ? InboxOutlined : kind === 'tasks' ? CodeOutlined : item.type === 'bug' ? CheckSquareOutlined : FileTextOutlined" aria-hidden="true" /></span><span class="ui-work-description"><strong>{{ item.title }}</strong><span class="muted">{{ item.projectName }} · {{ kind === 'deliveries' ? $t('交付') : kind === 'tasks' ? $t('开发任务') : item.type === 'bug' ? $t('缺陷') : $t('需求') }}<template v-if="item.number"> · #{{ item.number }}</template><template v-if="item.releaseName"> · {{ item.releaseName }}</template></span></span><span class="ui-work-person"><PersonAvatar :name="person(item) || $t('待分派')" />{{ person(item) || $t('待分派') }}</span><time class="ui-work-date">{{ formatDate(item.createdAt, { year: undefined, month: 'short', day: 'numeric' }) }}</time><span class="ui-row-action">{{ kind === 'deliveries' ? $t('查看交付') : kind === 'tasks' ? (item.status === 'planned' ? $t('查看任务') : $t('继续')) : $t('查看') }}</span></button></li></ul>
</template>
