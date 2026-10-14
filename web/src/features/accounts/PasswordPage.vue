<script setup>
import LocaleSelect from "../../shared/components/LocaleSelect.vue";
import { useRouter } from "vue-router";
import { logoutAccount } from "../../shared/api/account-session.js";
import PasswordForm from "./PasswordForm.vue";
const router = useRouter();
</script>
<template>
  <main class="authentication-page"><section class="authentication-card"><div class="ui-auth-language"><LocaleSelect /></div><div class="eyebrow">ACCOUNT SECURITY</div><h1>{{ $t("设置你的新密码") }}</h1><p class="muted">{{ $t("首次登录或密码重置后，需要修改密码才能进入工作台。") }}</p><PasswordForm @saved="router.replace('/')" /><button class="text-button" @click="logoutAccount">{{ $t("退出登录") }}</button></section></main>
</template>
