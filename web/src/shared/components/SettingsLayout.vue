<script setup>
import PageHeader from "./PageHeader.vue";
defineProps({ title: String, description: String, label: String, items: { type: Array, default: () => [] }, active: String });
const emit = defineEmits(["select"]);
</script>
<template>
  <section class="settings-page">
    <PageHeader :title="title" :description="description" />
    <div class="ui-settings-layout">
      <nav class="ui-settings-menu" :aria-label="title"><p>{{ label }}</p><button v-for="item in items" :key="item.id" :class="{ active: item.id === active }" :aria-current="item.id === active ? 'page' : undefined" @click="emit('select', item.id)"><component :is="item.icon" v-if="item.icon" aria-hidden="true" />{{ $t(item.label) }}</button></nav>
      <div class="ui-settings-content"><slot /></div>
    </div>
  </section>
</template>
