<script setup>
import { computed } from "vue";
import { ReloadOutlined } from "@antdv-next/icons";
import FormSection from "../../shared/components/FormSection.vue";
import { useGitAccounts } from "./use-git-accounts.js";
const {
  accounts,
  form,
  loading,
  saving,
  checking,
  generating,
  deleting,
  busy,
  ready,
  error,
  notice,
  deleteId,
  edit,
  load,
  save,
  check,
  generate,
  remove,
  changeAuthType,
} = useGitAccounts();
const httpWarning = computed(() => /^http:\/\//i.test(form.remoteUrl));
</script>

<template>
  <FormSection
    class="git-account-settings"
    title="Git 账号"
    description="可维护多个 Git 账号。保存前会使用当前填写的凭据检测仓库连接，检测成功后才保存。"
  >
    <template #action
      ><button type="button" class="text-button" :disabled="busy" @click="load">
        <ReloadOutlined aria-hidden="true" />刷新账号
      </button></template
    >
    <p v-if="loading" class="muted" role="status">正在加载 Git 账号…</p>
    <div
      v-else-if="accounts.length"
      class="account-list"
      aria-label="已保存 Git 账号"
    >
      <div
        v-for="account in accounts"
        :key="account.id"
        class="account-list-row"
      >
        <div class="account-list-identity">
          <strong>{{ account.name }}</strong
          ><span class="muted">{{
            account.authType === "ssh" ? "SSH 密钥" : "HTTP/HTTPS 凭据"
          }}</span>
        </div>
        <div class="account-row-actions">
          <button
            type="button"
            :disabled="busy"
            :aria-label="`编辑 Git 账号：${account.name}`"
            @click="edit(account)"
          >
            编辑</button
          ><button
            type="button"
            :disabled="busy"
            :aria-label="`删除 Git 账号：${account.name}`"
            @click="deleteId = account.id"
          >
            删除
          </button>
        </div>
      </div>
    </div>
    <p v-else class="muted">尚未添加 Git 账号。</p>
    <div
      v-if="deleteId"
      class="notice"
      role="group"
      aria-label="确认删除 Git 账号"
    >
      <p>
        确认删除「{{
          accounts.find((account) => account.id === deleteId)?.name
        }}」？工作区正在使用的账号不能删除。
      </p>
      <div class="actions">
        <button type="button" :disabled="busy" @click="deleteId = ''">
          取消删除</button
        ><button type="button" class="danger" :disabled="busy" @click="remove">
          {{ deleting ? "正在删除…" : "确认删除 Git 账号" }}
        </button>
      </div>
    </div>
    <a-form :model="form" layout="vertical" @finish="save">
      <a-form-item label="账号名称" html-for="git-account-name"
        ><input
          id="git-account-name"
          v-model="form.name"
          maxlength="80"
          required
          :disabled="busy"
          placeholder="例如：公司 Git"
      /></a-form-item>
      <a-form-item label="认证方式" html-for="git-account-auth-type"
        ><select
          id="git-account-auth-type"
          v-model="form.authType"
          :disabled="busy"
          @change="changeAuthType"
        >
          <option value="http">HTTP/HTTPS · 账号密码或令牌</option>
          <option value="ssh">SSH · 系统生成密钥</option>
        </select></a-form-item
      >
      <a-form-item label="Git 远程地址" html-for="git-account-remote"
        ><input
          id="git-account-remote"
          v-model="form.remoteUrl"
          required
          :disabled="busy"
          placeholder="例如：http://git.example.com/team/project.git"
        />
        <p class="field-hint">
          填写完整仓库克隆地址，不是 Git 服务首页。此地址用于验证仓库读取权限。
        </p>
        <p v-if="httpWarning" class="warning" role="status">
          HTTP 不加密传输凭据，仅建议在可信网络的开发环境使用。
        </p></a-form-item
      >
      <template v-if="form.authType === 'http'">
        <a-form-item label="用户名" html-for="git-account-user"
          ><input
            id="git-account-user"
            v-model="form.username"
            required
            :disabled="busy"
            autocomplete="off"
        /></a-form-item>
        <a-form-item label="密码或访问令牌" html-for="git-account-password"
          ><input
            id="git-account-password"
            v-model="form.password"
            type="password"
            :required="!form.id"
            :disabled="busy"
            autocomplete="new-password"
          />
          <p class="field-hint">
            支持普通账号密码或个人访问令牌，具体由 Git 服务决定。{{
              form.id
                ? "留空保留已保存密码；填写新值后将先检测再替换。"
                : "凭据加密保存，不会回显。"
            }}
          </p></a-form-item
        >
      </template>
      <a-form-item v-else label="SSH 公钥" html-for="git-account-public-key">
        <textarea
          v-if="form.publicKey"
          id="git-account-public-key"
          :value="form.publicKey"
          readonly
          rows="4"
          aria-label="SSH 公钥"
          spellcheck="false"
          @focus="$event.target.select()"
        />
        <p class="field-hint">
          系统生成 Ed25519 密钥。请复制公钥到 Git 服务的 SSH
          密钥设置；私钥仅在服务端加密保管，不会显示或下载。替换密钥需重新检测并保存才生效。
        </p>
        <button type="button" :disabled="busy" @click="generate">
          {{
            generating
              ? "正在生成密钥…"
              : form.publicKey
                ? "重新生成 SSH 密钥"
                : "生成 SSH 密钥"
          }}
        </button>
      </a-form-item>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="notice" class="success" role="status">{{ notice }}</p>
      <div class="actions">
        <button type="button" :disabled="busy" @click="edit()">新建账号</button
        ><button type="button" :disabled="busy || !ready" @click="check">
          {{ checking ? "正在检测…" : "测试连接" }}</button
        ><button type="submit" class="primary" :disabled="busy || !ready">
          {{ saving ? "正在检测并保存…" : "检测并保存 Git 账号" }}
        </button>
      </div>
    </a-form>
  </FormSection>
</template>
