<script setup>
import { ArrowRightOutlined } from "@antdv-next/icons";
import RelativeTime from "../../shared/components/RelativeTime.vue";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
import StatusBadge from "../../shared/components/StatusBadge.vue";
defineProps({ project: { type: Object, required: true }, index: { type: Number, default: 0 } });
const emit = defineEmits(["open"]);
</script>
<template>
  <article class="project-card project-entry-card" @click="emit('open', project.id)">
    <div class="project-card-top"><span class="project-monogram" :class="`project-tone-${index % 3}`" aria-hidden="true">{{ Array.from(project.name)[0]?.toUpperCase() }}</span><StatusBadge>{{ project.status === 'archived' ? $t('已归档') : $t('进行中') }}</StatusBadge></div>
    <h2><button class="ui-title-link" @click.stop="emit('open', project.id)">{{ project.name }}</button></h2>
    <p>{{ project.description || $t('尚未填写项目说明') }}</p>
    <div class="project-card-meta"><span v-if="Number.isInteger(project.issueCount)">{{ $t('{count} 个事项', { count: project.issueCount }) }}</span><span v-if="project.updatedAt"><RelativeTime :value="project.updatedAt" v-slot="{ text }">{{ $t('{time}更新', { time: text }) }}</RelativeTime></span></div>
    <footer><span class="ui-avatar-stack"><PersonAvatar v-for="(person, position) in project.memberPreview" :key="person.id" :name="person.displayName" :tone="position" /><span v-if="project.memberCount > 3" class="muted">+{{ project.memberCount - 3 }}</span></span><button class="ui-text-link" :aria-label="$t('进入项目 {name}', { name: project.name })" @click.stop="emit('open', project.id)">{{ $t('进入项目') }}<ArrowRightOutlined aria-hidden="true" /></button></footer>
  </article>
</template>
