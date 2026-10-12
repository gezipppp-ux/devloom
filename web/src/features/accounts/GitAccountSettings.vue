<script setup>
import { ReloadOutlined } from "@antdv-next/icons";
import FormSection from "../../shared/components/FormSection.vue";
import { useGitAccounts } from "./use-git-accounts.js";
const {
  accounts,
  form,
  loading,
  saving,
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
  generate,
  remove,
  changeAuthType,
} = useGitAccounts();
</script>

<template>
  <FormSection
    id="git-accounts"
    class="git-account-settings"
    title="Git 账号"
    description="维护适用于 Git 主机的多个个人账号。开发空间准备时检测项目仓库的实际访问权限。"
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
      <a-form-item label="Git 主机" html-for="git-account-host"
        ><input
          id="git-account-host"
          v-model="form.host"
          required
          :disabled="busy"
          placeholder="例如：git.example.com"
        />
        <p class="field-hint">
          填写 Git 服务的主机名；项目仓库由管理员单独维护。
        </p>
        </a-form-item
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
                ? "留空保留已保存密码。"
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
          密钥设置；私钥仅在服务端加密保管，不会显示或下载。替换密钥保存后生效。
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
      <div class="form-columns"><a-form-item label="提交作者姓名" html-for="git-author-name"><input id="git-author-name" v-model="form.authorName" :disabled="busy" /></a-form-item><a-form-item label="提交作者邮箱" html-for="git-author-email"><input id="git-author-email" v-model="form.authorEmail" type="email" :disabled="busy" /></a-form-item></div>
      <p class="field-hint">提交作者身份与 Git 登录凭据独立；不填写时沿用服务端已配置的 Git 作者身份。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="notice" class="success" role="status">{{ notice }}</p>
      <div class="actions">
        <button type="button" :disabled="busy" @click="edit()">新建账号</button
        ><button type="submit" class="primary" :disabled="busy || !ready">
          {{ saving ? "正在保存…" : "保存 Git 账号" }}
        </button>
      </div>
    </a-form>
  </FormSection>
</template>
