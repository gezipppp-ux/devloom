<script setup>
import { computed, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { accountSession } from "../shared/api/account-session.js";
import OperationMessages from "../shared/components/OperationMessages.vue";
import { clearMessages } from "../shared/components/operation-messages.js";
const route = useRoute();
const router = useRouter();
watch(() => accountSession.generation, clearMessages, { flush: "sync" });
// Remove protected components before asynchronous navigation finishes. A fresh
// instance must never issue requests using the next account's generation.
const canRender = computed(() => route.name === "login" || Boolean(
  accountSession.user &&
  (!accountSession.user.mustChangePassword || route.name === "password") &&
  (!route.meta.admin || accountSession.user.role === "admin"),
));
watch(() => accountSession.user, (user) => {
  if (!user && route.name !== "login") void router.replace({ name: "login" });
  else if (user?.mustChangePassword && route.name !== "password")
    void router.replace({ name: "password" });
  else if (user && user.role !== "admin" && route.meta.admin)
    void router.replace({ name: "personal" });
});
</script>
<template>
  <OperationMessages />
  <RouterView v-slot="{ Component }">
    <component :is="Component" v-if="canRender" :key="accountSession.generation" />
  </RouterView>
</template>
