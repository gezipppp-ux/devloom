/* global window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function verifyAccountProfileRaces(browser, origin) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const gates = new Map(), requests = [], errors = [];
  let actor = { id: "alice", username: "alice", displayName: "Alice", role: "member", status: "active" };
  const settings = { model: "fixture-model", grouping: "none" };
  const hold = (endpoint) => new Promise(resolve => gates.set(endpoint, resolve));
  page.on("pageerror", error => errors.push(error.message));
  // Import the real browser modules in an isolated page so generation and token
  // preservation can be checked without adding test exports to the product.
  await page.route("**/profile-fixture/**", route => {
    const name = new URL(route.request().url()).pathname.slice('/profile-fixture/'.length);
    if (name === "index.html") return route.fulfill({ contentType: "text/html", body: '<script type="importmap">{"imports":{"vue":"/profile-fixture/vue.js","vue-i18n":"/profile-fixture/vue-i18n.js"}}</script><script type="module">import * as account from "/profile-fixture/api/account-session.js"; window.account = account; await account.loadAccountSession(); window.ready = true;</script>' });
    const vendor = { 'vue.js': 'node_modules/vue/dist/vue.esm-browser.prod.js', 'vue-i18n.js': 'node_modules/vue-i18n/dist/vue-i18n.esm-browser.prod.js' };
    assert.ok(vendor[name] || /^(api\/(account-session|api)|i18n\/(index|en(?:-common|-actions|-details|-dynamic|-parameters|-feedback)?))\.js$/.test(name));
    const file = vendor[name] || `web/src/shared/${name}`;
    return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.resolve(file), "utf8") });
  });
  await page.route("**/api/**", async route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname;
    if (!endpoint.startsWith('/api/')) return route.fallback();
    const body = request.method() === "POST" ? request.postDataJSON() : undefined;
    requests.push({ endpoint, body, token: request.headers()["x-csrf-token"] });
    let result;
    if (endpoint === "/api/auth/session") result = { user: { ...actor }, settings, token: `token-${actor.id}` };
    else if (endpoint === "/api/account/profile") result = { user: { ...actor, displayName: body.displayName } };
    else throw new Error(`Unexpected profile endpoint: ${endpoint}`);
    const release = () => route.fulfill({ json: result });
    const gate = gates.get(endpoint);
    if (gate) { gates.delete(endpoint); gate({ release }); return; }
    await release();
  });
  const startSave = (displayName) => page.evaluate(name => {
    window.saveResult = null;
    window.savePromise = window.account.saveAccountProfile({ displayName: name }).then(user => {
      window.saveResult = { user };
    }, error => { window.saveResult = { error: error.name }; });
  }, displayName);
  const startRead = () => page.evaluate(() => {
    window.readDone = false;
    window.readPromise = window.account.revalidateAccountSession().then(() => { window.readDone = true; });
  });
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.account.accountSession)));
  try {
    await page.goto(`${origin}/profile-fixture/index.html`);
    await page.waitForFunction(() => window.ready);
    const before = await state();
    await startSave("新的显示名");
    await page.waitForFunction(() => window.saveResult);
    const after = await state();
    assert.equal(after.user.displayName, "新的显示名");
    assert.equal(after.user.username, "alice");
    assert.equal(after.generation, before.generation);
    assert.deepEqual(after.settings, before.settings);
    assert.equal(requests.at(-1).token, "token-alice");
    await startSave("第二次显示名");
    await page.waitForFunction(() => window.saveResult);
    assert.equal(requests.at(-1).token, "token-alice", "profile saving must preserve the next request's CSRF token");

    const heldOldRead = hold("/api/auth/session");
    await startRead();
    const oldRead = await heldOldRead;
    await startSave("读取之后保存");
    await page.waitForFunction(() => window.saveResult);
    await oldRead.release();
    await page.waitForFunction(() => window.readDone);
    assert.equal((await state()).user.displayName, "读取之后保存", "late session snapshots cannot restore the old display name");

    const heldSave = hold("/api/account/profile");
    await startSave("保存期间重新鉴权");
    const save = await heldSave;
    actor = { ...actor, role: "admin", departmentId: "new-department" };
    await startRead();
    await page.waitForFunction(() => window.readDone);
    await save.release();
    await page.waitForFunction(() => window.saveResult);
    assert.equal((await state()).user.role, "admin", "profile responses cannot restore an earlier role");
    assert.equal((await state()).user.departmentId, "new-department");
    assert.equal((await state()).user.displayName, "保存期间重新鉴权");

    actor = { ...actor, role: "member", departmentId: "third-department" };
    const heldPermissionRead = hold("/api/auth/session");
    await startRead();
    const permissionRead = await heldPermissionRead;
    await startSave("最新显示名");
    await page.waitForFunction(() => window.saveResult);
    await permissionRead.release();
    await page.waitForFunction(() => window.readDone);
    assert.equal((await state()).user.role, "member", "preserving a display name must not discard newly revalidated permissions");
    assert.equal((await state()).user.departmentId, "third-department");
    assert.equal((await state()).user.displayName, "最新显示名");

    const heldPreviousAccount = hold("/api/account/profile");
    await startSave("不应写入 Bob");
    const previousAccount = await heldPreviousAccount;
    await page.evaluate(() => window.account.clearAccountSession());
    actor = { id: "bob", username: "bob", displayName: "Bob", role: "member", status: "active" };
    await page.evaluate(() => window.account.loadAccountSession());
    await previousAccount.release();
    await page.waitForFunction(() => window.saveResult);
    assert.equal(await page.evaluate(() => window.saveResult.error), "AbortError");
    assert.equal((await state()).user.displayName, "Bob");
    assert.deepEqual(errors, []);
    process.stdout.write("Account profile races passed: identity, settings, token, revalidation and account isolation.\n");
  } finally { await context.close(); }
}

module.exports = { verifyAccountProfileRaces };
