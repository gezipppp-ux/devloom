<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: "" },
  number: { type: String, default: "" },
});
</script>

<template>
  <section class="form-section" :aria-label="title">
    <header class="form-section-heading">
      <span v-if="number" class="section-number" aria-hidden="true">{{
        number
      }}</span>
      <div>
        <h2>{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <div v-if="$slots.action" class="section-action">
        <slot name="action" />
      </div>
    </header>
    <slot />
  </section>
</template>
