<script setup>
import { nextTick, ref, watch } from "vue";
import AppSelect from "../../shared/components/AppSelect.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { PlusOutlined, ReloadOutlined } from "@antdv-next/icons";
import { useGitAccounts } from "./use-git-accounts.js";
const {
  accounts,
  form,
  formOpen,
  hostPresets,
  hostPreset,
  officialHost,
  hasSavedHttpCredential,
  selectHostPreset,
  loading,
  saving,
  checking,
  provider,
  generating,
  deleting,
  busy,
  ready,
  error,
  notice,
  deleteId,
  edit,
  cancel,
  load,
  save,
  verify,
  generate,
  remove,
  changeAuthType,
} = useGitAccounts();
const nameInput = ref(null), addButton = ref(null);
let editorTrigger;
async function openEditor(account, event) {
  editorTrigger = event.currentTarget;
  edit(account);
  await nextTick();
  nameInput.value?.focus();
}
watch(formOpen, async (open) => {
  if (open) return;
  await nextTick();
  (editorTrigger?.isConnected ? editorTrigger : addButton.value)?.focus();
});
</script>

<template>
  <section id="git-accounts" class="git-account-settings" :aria-label="$t('Git 账号')">
    <header class="ui-settings-heading"><div><h2>{{ $t("Git 账号") }}</h2><p>{{ $t("连接仓库使用的个人凭据与提交身份。") }}</p></div><div class="git-heading-actions"><button type="button" class="text-button" :disabled="busy" @click="load">
        <ReloadOutlined aria-hidden="true" />{{ $t("刷新账号") }}
      </button><button ref="addButton" type="button" class="primary" :disabled="busy || formOpen" @click="openEditor(undefined, $event)"><PlusOutlined aria-hidden="true" />{{ $t("添加 Git 账号") }}</button></div></header>
    <FeedbackMessage :message="error" type="error" />
    <FeedbackMessage :message="notice" type="success" />
    <h3 class="git-list-heading">{{ $t("已添加账号") }}<span class="muted">{{ $n(accounts.length) }}</span></h3>
    <p v-if="loading" class="muted" role="status">{{ $t("正在加载 Git 账号…") }}</p>
    <div
      v-else-if="accounts.length"
      class="account-list git-saved-accounts"
      :aria-label="$t('已保存 Git 账号')"
    >
      <div
        v-for="account in accounts"
        :key="account.id"
        class="account-list-row"
        :class="{ 'git-account-editing': formOpen && form.id === account.id }"
      >
        <div class="account-list-identity">
          <strong>{{ account.name }} <span v-if="formOpen && form.id === account.id" class="git-editing-label">{{ $t("正在编辑") }}</span></strong
          ><span class="muted">{{ account.host }} · {{
            account.authType === "ssh" ? $t("SSH 密钥") : $t("HTTP/HTTPS 凭据")
          }}</span>
        </div>
        <div class="account-row-actions">
          <button
            type="button"
            :disabled="busy"
            :aria-label="$t('编辑 Git 账号：{p0}', { p0: account.name })"
            @click="openEditor(account, $event)"
          >
            {{ $t("编辑") }}</button
          ><button
            type="button"
            :disabled="busy"
            :aria-label="$t('删除 Git 账号：{p0}', { p0: account.name })"
            @click="deleteId = account.id"
          >
            {{ $t("删除") }}
          </button>
        </div>
      </div>
    </div>
    <p v-else class="muted">{{ $t("尚未添加 Git 账号。") }}</p>
    <div
      v-if="deleteId"
      class="notice"
      role="group"
      :aria-label="$t('确认删除 Git 账号')"
    >
      <p>
        {{ $t("确认删除「") }}{{
          accounts.find((account) => account.id === deleteId)?.name
        }}{{ $t("」？工作区正在使用的账号不能删除。") }}
      </p>
      <div class="actions">
        <button type="button" :disabled="busy" @click="deleteId = ''">
          {{ $t("取消删除") }}</button
        ><button type="button" class="danger" :disabled="busy" @click="remove">
          {{ deleting ? $t("正在删除…") : $t("确认删除 Git 账号") }}
        </button>
      </div>
    </div>
    <a-form v-if="formOpen" class="git-settings-form" :model="form" layout="vertical" aria-labelledby="git-editor-title" @finish="save">
      <header class="git-editor-heading"><h3 id="git-editor-title">{{ form.id ? $t("编辑账号 · {name}", { name: accounts.find(account => account.id === form.id)?.name }) : $t("添加 Git 账号") }}</h3><p class="field-hint">{{ form.id ? $t("修改此账号的连接凭据或提交身份。") : $t("填写新的连接凭据，保存后将出现在已添加账号中。") }}</p></header>
      <section class="git-form-section">
      <a-form-item :label="$t('账号名称')" html-for="git-account-name"
        ><input
          id="git-account-name"
          ref="nameInput"
          v-model="form.name"
          maxlength="80"
          required
          :disabled="busy"
          :placeholder="$t('例如：公司 Git')"
      /></a-form-item>
      <a-form-item :label="$t('Git 主机')" html-for="git-account-host-preset">
        <AppSelect id="git-account-host-preset" :model-value="hostPreset" :disabled="busy" @update:model-value="selectHostPreset">
          <option v-for="preset in hostPresets" :key="preset.id" :value="preset.id">{{ preset.label }} · {{ preset.hostname }}</option>
          <option value="custom">{{ $t("自定义主机") }}</option>
        </AppSelect>
        <p v-if="hostPreset !== 'custom'" class="field-hint git-host-address">{{ form.host }}</p>
      </a-form-item>
      <a-form-item v-if="hostPreset === 'custom'" :label="$t('Git 主机地址')" html-for="git-account-host"><input
          id="git-account-host"
          v-model="form.host"
          required
          :disabled="busy"
          :placeholder="form.authType === 'ssh' ? $t('例如：gitee.com') : $t('例如：https://gitee.com')"
          aria-describedby="git-account-host-hint"
        />
        <p id="git-account-host-hint" class="field-hint">
          {{ form.authType === 'ssh' ? $t("填写主机名和可选端口，例如 gitee.com，不要填写 git@gitee.com 或仓库路径。") : $t("填写完整主机地址，例如 https://gitee.com，不包含仓库路径。") }}{{ $t("项目仓库由管理员单独维护。") }}
        </p>
        </a-form-item
      >
      <a-form-item :label="$t('认证方式')" html-for="git-account-auth-type"><AppSelect native-events id="git-account-auth-type" v-model="form.authType" :disabled="busy" @change="changeAuthType"><option value="http">{{ $t("HTTP/HTTPS · 账号密码或令牌") }}</option><option value="ssh">{{ $t("SSH · 系统生成密钥") }}</option></AppSelect></a-form-item>
      <div v-if="form.authType === 'http'" class="form-columns">
        <a-form-item :label="$t('用户名')" html-for="git-account-user"
          ><input
            id="git-account-user"
            v-model="form.username"
            required
            :disabled="busy"
            autocomplete="off"
        /><p class="field-hint">{{ $t("Gitea 可填写登录用户名或邮箱；其他服务请填写登录用户名。") }}</p></a-form-item>
        <a-form-item :label="$t('密码或访问令牌')" html-for="git-account-password"
          ><input
            id="git-account-password"
            v-model="form.password"
            type="password"
            :placeholder="hasSavedHttpCredential ? $t('已保存，留空保持不变') : ''"
            :required="!hasSavedHttpCredential"
            :disabled="busy"
            autocomplete="new-password"
          />
          <p class="field-hint">
            {{ $t("仓库访问支持密码或个人访问令牌，具体由 Git 服务决定。Gitea 登录验证也支持普通密码。") }}{{
              hasSavedHttpCredential
                ? $t("留空保留已保存密码。")
                : $t("凭据加密保存，不会回显。")
            }}
          </p></a-form-item
        >
      </div>
      <a-form-item v-else :label="$t('SSH 公钥')" html-for="git-account-public-key">
        <textarea
          v-if="form.publicKey"
          id="git-account-public-key"
          :value="form.publicKey"
          readonly
          rows="4"
          :aria-label="$t('SSH 公钥')"
          spellcheck="false"
          @focus="$event.target.select()"
        />
        <p class="field-hint">
          {{ $t("系统生成 Ed25519 密钥。请复制公钥到 Git 服务的 SSH 密钥设置；私钥仅在服务端加密保管，不会显示或下载。替换密钥保存后生效。") }}
        </p>
        <button type="button" :disabled="busy" @click="generate">
          {{
            generating
              ? $t("正在生成密钥…")
              : form.publicKey
                ? $t("重新生成 SSH 密钥")
                : $t("生成 SSH 密钥")
          }}
        </button>
      </a-form-item>
      <template v-if="form.authType === 'http'">
      <a-form-item v-if="!officialHost" :label="$t('登录验证服务')" html-for="git-login-provider">
        <AppSelect native-events id="git-login-provider" v-model="provider" :disabled="busy" aria-describedby="git-login-hint">
          <option value="auto">{{ $t("自动识别（官方主机 / 自建 Gitea）") }}</option>
          <option value="gitee">Gitee</option>
          <option value="github">GitHub / GitHub Enterprise</option>
          <option value="gitlab">{{ $t("GitLab / 自建 GitLab") }}</option>
          <option value="gitea">{{ $t("Gitea / 自建 Gitea") }}</option>
        </AppSelect>
        <p id="git-login-hint" class="field-hint">{{ $t("自动识别 Gitee / GitHub / GitLab 官方主机和公开标识为 Gitea 的自建服务。其他自建服务请手动选择对应类型，此选项仅用于本次验证。") }}</p>
      </a-form-item>
        <p v-else class="field-hint">{{ $t("已根据主机匹配 {service} 登录验证，无需重复选择服务。", { service: officialHost.label }) }}</p>
        <p class="field-hint">{{ $t("Gitea 支持用户名或邮箱搭配密码；启用双重验证时请使用个人访问令牌（至少 read:user）。其他服务的登录验证需使用可读取本人资料的个人访问令牌。验证不会保存账号，也不代表仓库权限。") }}</p>
        <p v-if="/^http:\/\//i.test(form.host.trim())" class="field-hint">{{ $t("HTTP 会以明文传输凭据，建议使用 HTTPS。") }}</p>
      </template>
      <p v-else class="field-hint">{{ $t("验证登录会使用当前公钥连接 Git 主机的 git 用户。请先将公钥添加到 Git 服务；验证不会保存或替换账号密钥。") }}</p>
      </section>
      <section class="git-form-section git-author-section"><h3>{{ $t("提交作者") }}</h3>
      <div class="form-columns"><a-form-item :label="$t('提交作者姓名')" html-for="git-author-name"><input id="git-author-name" v-model="form.authorName" :disabled="busy" /></a-form-item><a-form-item :label="$t('提交作者邮箱')" html-for="git-author-email"><input id="git-author-email" v-model="form.authorEmail" type="email" :disabled="busy" /></a-form-item></div>
      <p class="field-hint">{{ $t("提交作者身份与 Git 登录凭据独立；不填写时沿用服务端已配置的 Git 作者身份。") }}</p>
      </section>
      <footer class="git-form-footer">
      <div class="actions">
        <button type="button" class="git-cancel" :disabled="busy" @click="cancel">{{ $t("取消") }}</button
        ><button type="button" :disabled="busy || !ready" @click="verify">
          {{ checking ? $t("正在验证登录…") : $t("验证登录") }}
        </button
        ><button type="submit" class="primary" :disabled="busy || !ready">
          {{ saving ? $t("正在保存…") : form.id ? $t("保存修改") : $t("添加账号") }}
        </button>
      </div>
      </footer>
    </a-form>
  </section>
</template>
<style scoped>
.git-account-settings { max-width: 1160px; min-width: 0; }
.git-heading-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.git-list-heading { display: flex; gap: 10px; align-items: baseline; font-size: 16px; margin: 0 0 12px; }
.git-list-heading .muted { font-size: 13px; font-weight: 400; }
.git-account-editing { background: var(--accent-subtle); }
.git-editing-label { color: var(--accent); font-size: 12px; font-weight: 400; margin-left: 8px; }
.account-list-identity { min-width: 0; overflow-wrap: anywhere; }
.git-saved-accounts { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); margin-bottom: 24px; overflow: hidden; }
.git-saved-accounts .account-list-row { padding: 20px 28px; }
.git-settings-form { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); overflow: hidden; }
.git-editor-heading { padding: 24px 28px; border-bottom: 1px solid var(--line); background: var(--surface-hover); }
.git-editor-heading h3 { margin: 0 0 8px; font-size: 18px; overflow-wrap: anywhere; }
.git-editor-heading p { margin: 0; }
.git-form-section { padding: 28px; min-width: 0; }
.git-form-section + .git-form-section { border-top: 1px solid var(--line); }
.git-form-section > :deep(.ant-form-item:last-child) { margin-bottom: 0; }
.git-author-section h3 { font-size: 18px; margin: 0 0 20px; }
.git-form-footer { border-top: 1px solid var(--line); padding: 20px 28px; }
.git-form-footer .actions { margin: 0; justify-content: flex-end; }
.git-cancel { margin-right: auto; }
@media (max-width: 767px) { .git-form-section, .git-form-footer, .git-editor-heading, .git-saved-accounts .account-list-row { padding: 20px; } }
</style>
