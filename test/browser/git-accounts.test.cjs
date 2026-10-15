const { selectOption } = require("../support/select.cjs");
const { dismissOperationMessages } = require("../support/operation-feedback.cjs");
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
    if (url.pathname.endsWith("/verify")) return fail ? send({ error: "模拟登录验证失败：请检查令牌或公钥授权。" }, 400) : send({ ok: true });
    if (fail) return send({ error: "模拟保存失败：请检查地址和凭据。" }, 400);
    if (url.pathname.endsWith("/check") || url.pathname.endsWith("/test")) return send({ ok: true });
    const id = url.pathname.split("/").length === 5 ? url.pathname.split("/").at(-1) : String(++sequence);
    const account = { id, name: data.name, authType: data.authType, host: data.host, authorName: data.authorName, authorEmail: data.authorEmail, revision: (data.revision || 0) + 1, username: data.username || "", publicKey: data.authType === "ssh" ? publicKey : "" };
    const index = accounts.findIndex(saved => saved.id === id);
    if (index >= 0) accounts[index] = account; else accounts.push(account);
    return send({ account });
  });
  await page.getByRole("navigation", { name: "个人设置", exact: true }).getByRole("button", { name: "Git 账号", exact: true }).click();
  const section = page.locator(".git-account-settings");
  const save = section.getByRole("button", { name: /^(添加账号|保存修改)$/ });
  const verify = section.getByRole("button", { name: "验证登录", exact: true });
  async function captureForms(prefix) {
    await dismissOperationMessages(page);
    for (const [width, height] of [[2560, 1440], [1920, 1080], [1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 740]]) {
      await page.setViewportSize({ width, height });
      await section.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      const spacings = await section.locator(".ant-form-item").evaluateAll(items => items.map(item => {
        const label = item.querySelector(".ant-form-item-label")?.getBoundingClientRect();
        const control = item.querySelector("input,select,textarea")?.getBoundingClientRect();
        return !label || !control || control.top >= label.bottom;
      }));
      assert.ok(spacings.every(Boolean), "labels cannot overlap form controls");
      const pane = page.locator(".ui-settings-content");
      if (width >= 768) {
        await pane.evaluate(node => { node.scrollTop = 0; });
        const before = await page.evaluate(() => ({
          title: document.querySelector(".settings-page > .ui-page-header").getBoundingClientRect().top,
          menu: document.querySelector(".ui-settings-menu").getBoundingClientRect().top,
        }));
        if (await pane.evaluate(node => node.scrollHeight > node.clientHeight)) {
          const bounds = await pane.boundingBox();
          await page.mouse.move(bounds.x + bounds.width - 20, bounds.y + Math.min(100, bounds.height / 2));
          await page.mouse.wheel(0, 500);
          await page.waitForFunction(() => document.querySelector(".ui-settings-content").scrollTop > 0);
          assert.deepEqual(await page.evaluate(() => ({
            title: document.querySelector(".settings-page > .ui-page-header").getBoundingClientRect().top,
            menu: document.querySelector(".ui-settings-menu").getBoundingClientRect().top,
          })), before, "scrolling the right pane keeps the title and settings menu fixed");
        }
        assert.equal(await page.evaluate(() => window.scrollY), 0, "personal settings do not scroll the desktop document");
        if (await save.count()) {
          await section.getByLabel("提交作者邮箱", { exact: true }).focus();
          for (let tab = 0; tab < 3; tab++) await page.keyboard.press("Tab");
          assert.equal(await save.evaluate(node => node === document.activeElement), true, "keyboard navigation reaches the form action");
          const buttonBounds = await save.boundingBox(), paneBounds = await pane.boundingBox();
          assert.ok(buttonBounds.y >= paneBounds.y && buttonBounds.y + buttonBounds.height <= paneBounds.y + paneBounds.height + 1, "the form action is reachable inside the pane");
          await page.screenshot({ path: path.join(output, `${prefix}-footer-${width}.png`) });
        }
        await pane.evaluate(node => { node.scrollTop = 0; });
      } else if (await save.count()) {
        await save.scrollIntoViewIfNeeded();
        const buttonBounds = await save.boundingBox(), navBounds = await page.locator(".ui-bottom-nav").boundingBox();
        assert.ok(buttonBounds.y >= 0 && buttonBounds.y + buttonBounds.height <= navBounds.y + 1, "mobile navigation does not cover the form action");
      }
      await page.screenshot({ path: path.join(output, `${prefix}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  const add = section.getByRole("button", { name: "添加 Git 账号", exact: true });
  const cancel = section.getByRole("button", { name: "取消", exact: true });
  assert.equal(await section.locator("form").count(), 0, "the list must not look like a new account form");
  await add.click();
  await section.getByRole("heading", { name: "添加 Git 账号", exact: true }).waitFor();
  assert.equal(await section.getByLabel("账号名称", { exact: true }).evaluate(node => node === document.activeElement), true);
  await section.getByLabel("账号名称", { exact: true }).fill("取消的草稿");
  await cancel.click();
  assert.equal(writes.length, 0, "cancelling must not save a draft");
  assert.equal(await add.evaluate(node => node === document.activeElement), true);
  await add.click();
  assert.equal(await section.getByLabel("账号名称", { exact: true }).inputValue(), "");
  assert.equal(await verify.isDisabled(), true);
  const hostChoice = section.getByLabel("Git 主机", { exact: true });
  assert.equal(await section.locator(".git-host-address").innerText(), "https://github.com");
  assert.equal(await section.getByLabel("登录验证服务", { exact: true }).count(), 0);
  await selectOption(hostChoice, "gitee");
  await selectOption(section.getByLabel("认证方式", { exact: true }), "ssh");
  assert.equal(await section.locator(".git-host-address").innerText(), "gitee.com");
  await selectOption(section.getByLabel("认证方式", { exact: true }), "http");
  assert.equal(await section.locator(".git-host-address").innerText(), "https://gitee.com");
  await selectOption(hostChoice, "custom");
  await section.getByText("填写完整主机地址，例如 https://gitee.com，不包含仓库路径。项目仓库由管理员单独维护。", { exact: true }).waitFor();
  await section.getByLabel("账号名称", { exact: true }).fill("开发 HTTP Git");
  await section.getByLabel("Git 主机地址", { exact: true }).fill("http://git.example.test:3000");
  await selectOption(hostChoice, "gitlab");
  await selectOption(hostChoice, "custom");
  assert.equal(await section.getByLabel("Git 主机地址", { exact: true }).inputValue(), "http://git.example.test:3000", "switching presets preserves the custom host draft");
  await section.getByLabel("用户名", { exact: true }).fill("developer");
  await section.getByLabel("密码或访问令牌", { exact: true }).fill('fixture&password|%!"');
  await section.getByLabel("提交作者姓名", { exact: true }).fill("Fixture Author");
  await section.getByLabel("提交作者邮箱", { exact: true }).fill("fixture@example.invalid");
  await selectOption(section.getByLabel("登录验证服务", { exact: true }), "gitlab");
  const verifying = new Promise(resolve => { hold = resolve; });
  await verify.click();
  await verifying;
  assert.equal(await section.getByRole("button", { name: "正在验证登录…", exact: true }).isDisabled(), true);
  assert.equal(await save.isDisabled(), true);
  assert.equal(await section.getByLabel("密码或访问令牌", { exact: true }).isDisabled(), true);
  assert.equal(await cancel.isDisabled(), true);
  await section.screenshot({ path: path.join(output, "git-login-verifying.png") });
  gate();
  await page.getByRole("alert").filter({ hasText: "模拟登录验证失败" }).waitFor();
  assert.equal(accounts.length, 0);
  assert.equal(writes.at(-1).projectId, undefined);
  assert.equal(writes.at(-1).provider, "gitlab");
  assert.equal(await section.getByLabel("密码或访问令牌", { exact: true }).inputValue(), 'fixture&password|%!"');
  await dismissOperationMessages(page);
  const held = new Promise(resolve => { hold = resolve; });
  await save.click();
  await held;
  assert.equal(await section.getByLabel("用户名", { exact: true }).isDisabled(), true);
  assert.equal(await section.getByRole("button", { name: "测试连接", exact: true }).count(), 0);
  gate();
  await page.locator('.operation-message[data-type="error"]').filter({ hasText: "模拟保存失败" }).waitFor();
  assert.equal(accounts.length, 0);
  assert.equal(await section.getByLabel("密码或访问令牌", { exact: true }).inputValue(), 'fixture&password|%!"');
  await dismissOperationMessages(page);
  fail = false;
  await selectOption(section.getByLabel("登录验证服务", { exact: true }), "gitea");
  await verify.click();
  await page.locator('.operation-message[data-type="success"]').filter({ hasText: "Git 主机登录验证成功" }).waitFor();
  assert.equal(writes.at(-1).provider, "gitea");
  assert.equal(accounts.length, 0, "verification must not save a draft");
  await dismissOperationMessages(page);
  await save.click();
  await page.locator('.operation-message[data-type="success"]').filter({ hasText: "Git 账号已保存。准备项目开发空间时会验证实际仓库的访问权限。" }).waitFor();
  assert.equal(accounts.length, 1);
  assert.equal(await section.locator("form").count(), 0, "saving returns to the account list");
  await section.getByRole("button", { name: "编辑 Git 账号：开发 HTTP Git", exact: true }).click();
  await section.getByRole("heading", { name: "编辑账号 · 开发 HTTP Git", exact: true }).waitFor();
  assert.equal(await section.getByLabel("密码或访问令牌", { exact: true }).inputValue(), "");
  await verify.click();
  await page.locator('.operation-message[data-type="success"]').filter({ hasText: "Git 主机登录验证成功" }).waitFor();
  assert.equal(writes.at(-1).password, undefined, "verification reuses saved credentials without exposing them");
  assert.equal(writes.at(-1).revision, 1);
  await dismissOperationMessages(page);
  await section.getByLabel("账号名称", { exact: true }).fill("已修改 HTTP Git");
  await save.click();
  await section.getByRole("button", { name: "编辑 Git 账号：已修改 HTTP Git", exact: true }).waitFor();
  assert.equal(writes.at(-1).password, undefined);
  assert.equal(writes.at(-1).revision, 1);
  assert.equal(writes.at(-1).authorName, "Fixture Author");
  assert.equal(writes.at(-1).remoteUrl, undefined);
  await section.getByRole("button", { name: "编辑 Git 账号：已修改 HTTP Git", exact: true }).click();
  await captureForms("git-accounts-http");
  await selectOption(page.locator(".ui-locale"), "en");
  await section.getByRole("heading", { name: "Edit account · 已修改 HTTP Git", exact: true }).waitFor();
  assert.equal(await section.getByLabel("Account name", { exact: true }).inputValue(), "已修改 HTTP Git", "language switching preserves the editor");
  for (const [width, height] of [[1440, 900], [320, 740]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(output, `git-accounts-edit-en-${width}.png`), fullPage: true });
  }
  await selectOption(page.locator(".ui-locale"), "zh-CN");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const beforeCancel = writes.length;
  await section.getByLabel("账号名称", { exact: true }).fill("不会保存的修改");
  await cancel.click();
  assert.equal(writes.length, beforeCancel);
  assert.equal(accounts[0].name, "已修改 HTTP Git");
  await add.click();
  await section.getByRole("heading", { name: "添加 Git 账号", exact: true }).waitFor();
  assert.equal(await section.getByLabel("密码或访问令牌", { exact: true }).inputValue(), "");
  await section.getByLabel("账号名称", { exact: true }).fill("开发 SSH Git");
  await selectOption(hostChoice, "custom");
  await selectOption(section.getByLabel("认证方式", { exact: true }), "ssh");
  await section.getByText("填写主机名和可选端口，例如 gitee.com，不要填写 git@gitee.com 或仓库路径。项目仓库由管理员单独维护。", { exact: true }).waitFor();
  assert.equal(await section.getByLabel("Git 主机地址", { exact: true }).getAttribute("placeholder"), "例如：gitee.com");
  await section.getByLabel("Git 主机地址", { exact: true }).fill("git.example.test");
  assert.equal(await save.isDisabled(), true);
  await section.getByRole("button", { name: "生成 SSH 密钥", exact: true }).click();
  const key = section.getByLabel("SSH 公钥", { exact: true });
  await key.waitFor();
  assert.equal(await key.inputValue(), publicKey);
  assert.equal(await key.getAttribute("readonly"), "");
  assert.equal(await section.getByLabel("SSH 私钥", { exact: true }).count(), 0);
  assert.equal(await section.getByRole("button", { name: "测试连接", exact: true }).count(), 0);
  assert.equal(await section.getByLabel("登录验证服务", { exact: true }).count(), 0);
  await verify.click();
  await page.locator('.operation-message[data-type="success"]').filter({ hasText: "Git 主机登录验证成功" }).waitFor();
  assert.equal(writes.at(-1).keyDraftId, "fixture-draft");
  assert.equal(writes.at(-1).projectId, undefined);
  assert.equal(accounts.length, 1);
  await dismissOperationMessages(page);
  await save.click();
  await section.getByRole("button", { name: "编辑 Git 账号：开发 SSH Git", exact: true }).waitFor();
  assert.equal(writes.at(-1).keyDraftId, "fixture-draft");
  assert.equal(writes.at(-1).sshPrivateKey, undefined);
  assert.equal(await section.locator("form").count(), 0);
  await captureForms("git-accounts-list");
  await section.getByRole("button", { name: "编辑 Git 账号：开发 SSH Git", exact: true }).click();
  await section.getByRole("heading", { name: "编辑账号 · 开发 SSH Git", exact: true }).waitFor();
  await captureForms("git-accounts");
  await section.getByRole("button", { name: "删除 Git 账号：已修改 HTTP Git", exact: true }).click();
  assert.equal(accounts.length, 2, "delete needs explicit confirmation");
  await section.getByRole("button", { name: "取消删除", exact: true }).click();
  assert.equal(accounts.length, 2);
  await page.locator('.operation-message[data-type="success"]').filter({ hasText: "Git 主机登录验证成功" }).waitFor({ state: "hidden" });
  const pending = new Promise(resolve => { hold = resolve; });
  await verify.click();
  await pending;
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: "项目", exact: true }).click();
  await page.getByRole("heading", { name: "项目", exact: true }).waitFor();
  const completed = page.waitForResponse(response => response.url().endsWith("/verify"));
  gate();
  await completed;
  assert.equal(await page.locator('.operation-message[data-type="success"]').filter({ hasText: "Git 主机登录验证成功" }).count(), 0, "late verification must not notify after leaving personal settings");
  await page.getByRole("button", { name: "个人设置", exact: true }).click();
  await page.getByRole("navigation", { name: "个人设置", exact: true }).getByRole("button", { name: "Git 账号", exact: true }).click();
  await section.getByRole("button", { name: "编辑 Git 账号：开发 SSH Git", exact: true }).waitFor();
  process.stdout.write("Git account browser passed: host login, unsaved HTTP/SSH credentials, verification failures, revisions, explicit authors, generated public keys, confirmation and responsive forms.\n");
}
module.exports = { verifyGitAccounts };
