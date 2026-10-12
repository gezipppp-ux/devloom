/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifyGitAccounts(page, output) {
  const accounts = [], writes = [];
  let fail = true, sequence = 0, gate, hold;
  const publicKey = "ssh-ed25519 " + "A".repeat(68) + " fixture@web-coding";
  await page.route("**/api/account/git-**", async route => {
    const request = route.request(), url = new URL(request.url());
    const data = request.method() === "POST" ? request.postDataJSON() : undefined;
    const send = (json, status = 200) => route.fulfill({ json, status });
    if (url.pathname === "/api/account/git-keys") return send({ id: "fixture-draft", publicKey, expiresAt: Date.now() + 86400000 });
    if (!data) return send({ accounts });
    writes.push(data);
    if (hold) { const capture = hold; hold = undefined; await new Promise(resolve => { gate = resolve; capture(); }); }
    if (url.pathname.endsWith("/delete")) { accounts.splice(0, 1); return send({ ok: true }); }
    if (fail) return send({ error: "模拟保存失败：请检查地址和凭据。" }, 400);
    if (url.pathname.endsWith("/check") || url.pathname.endsWith("/test")) return send({ ok: true });
    const id = url.pathname.split("/").length === 5 ? url.pathname.split("/").at(-1) : String(++sequence);
    const account = { id, name: data.name, authType: data.authType, host: data.host, authorName: data.authorName, authorEmail: data.authorEmail, revision: (data.revision || 0) + 1, username: data.username || "", publicKey: data.authType === "ssh" ? publicKey : "" };
    const index = accounts.findIndex(saved => saved.id === id);
    if (index >= 0) accounts[index] = account; else accounts.push(account);
    return send({ account });
  });
  const section = page.locator(".git-account-settings");
  const save = section.getByRole("button", { name: "保存 Git 账号", exact: true });
  await section.getByText("填写完整主机地址，例如 https://gitee.com，不包含仓库路径。项目仓库由管理员单独维护。", { exact: true }).waitFor();
  await section.getByLabel("账号名称", { exact: true }).fill("开发 HTTP Git");
  await section.getByLabel("Git 主机", { exact: true }).fill("http://git.example.test:3000");
  await section.getByLabel("用户名", { exact: true }).fill("developer");
  await section.getByLabel("密码或访问令牌", { exact: true }).fill('fixture&password|%!"');
  await section.getByLabel("提交作者姓名", { exact: true }).fill("Fixture Author");
  await section.getByLabel("提交作者邮箱", { exact: true }).fill("fixture@example.invalid");
  const held = new Promise(resolve => { hold = resolve; });
  await save.click();
  await held;
  assert.equal(await section.getByLabel("用户名", { exact: true }).isDisabled(), true);
  assert.equal(await section.getByRole("button", { name: "测试连接", exact: true }).count(), 0);
  gate();
  await page.locator('.operation-message[data-type="error"]').filter({ hasText: "模拟保存失败" }).waitFor();
  assert.equal(accounts.length, 0);
  assert.equal(await section.getByLabel("密码或访问令牌", { exact: true }).inputValue(), 'fixture&password|%!"');
  fail = false;
  await save.click();
  await page.locator('.operation-message[data-type="success"]').filter({ hasText: "Git 账号已保存。准备项目开发空间时会验证实际仓库的访问权限。" }).waitFor();
  assert.equal(accounts.length, 1);
  assert.equal(await section.getByLabel("密码或访问令牌", { exact: true }).inputValue(), "");
  await section.getByLabel("账号名称", { exact: true }).fill("已修改 HTTP Git");
  await save.click();
  await section.getByRole("button", { name: "编辑 Git 账号：已修改 HTTP Git", exact: true }).waitFor();
  assert.equal(writes.at(-1).password, undefined);
  assert.equal(writes.at(-1).revision, 1);
  assert.equal(writes.at(-1).authorName, "Fixture Author");
  assert.equal(writes.at(-1).remoteUrl, undefined);
  await section.getByRole("button", { name: "新建账号", exact: true }).click();
  await section.getByLabel("账号名称", { exact: true }).fill("开发 SSH Git");
  await section.getByLabel("认证方式", { exact: true }).selectOption("ssh");
  await section.getByText("填写主机名和可选端口，例如 gitee.com，不要填写 git@gitee.com 或仓库路径。项目仓库由管理员单独维护。", { exact: true }).waitFor();
  assert.equal(await section.getByLabel("Git 主机", { exact: true }).getAttribute("placeholder"), "例如：gitee.com");
  await section.getByLabel("Git 主机", { exact: true }).fill("git.example.test");
  assert.equal(await save.isDisabled(), true);
  await section.getByRole("button", { name: "生成 SSH 密钥", exact: true }).click();
  const key = section.getByLabel("SSH 公钥", { exact: true });
  await key.waitFor();
  assert.equal(await key.inputValue(), publicKey);
  assert.equal(await key.getAttribute("readonly"), "");
  assert.equal(await section.getByLabel("SSH 私钥", { exact: true }).count(), 0);
  assert.equal(await section.getByRole("button", { name: "测试连接", exact: true }).count(), 0);
  assert.equal(accounts.length, 1);
  await save.click();
  await section.getByRole("button", { name: "编辑 Git 账号：开发 SSH Git", exact: true }).waitFor();
  assert.equal(writes.at(-1).keyDraftId, "fixture-draft");
  assert.equal(writes.at(-1).sshPrivateKey, undefined);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await section.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const spacings = await section.locator(".ant-form-item").evaluateAll(items => items.map(item => {
      const label = item.querySelector(".ant-form-item-label")?.getBoundingClientRect();
      const control = item.querySelector("input,select,textarea")?.getBoundingClientRect();
      return !label || !control || control.top >= label.bottom;
    }));
    assert.ok(spacings.every(Boolean), "labels cannot overlap form controls");
    await section.screenshot({ path: path.join(output, `git-accounts-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await section.getByRole("button", { name: "删除 Git 账号：已修改 HTTP Git", exact: true }).click();
  assert.equal(accounts.length, 2, "delete needs explicit confirmation");
  await section.getByRole("button", { name: "取消删除", exact: true }).click();
  assert.equal(accounts.length, 2);
  process.stdout.write("Git account browser passed: host credentials, failed drafts, revisions, explicit authors, generated public keys, confirmation and responsive forms.\n");
}
module.exports = { verifyGitAccounts };
