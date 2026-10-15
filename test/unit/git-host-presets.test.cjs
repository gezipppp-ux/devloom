const assert = require("node:assert/strict");
const { setImmediate } = require("node:timers/promises");
const { test } = require("node:test");

async function fixture(t, accounts = []) {
  const { createRenderer } = await import("vue");
  const { useGitAccounts } = await import("../../web/src/features/accounts/use-git-accounts.js");
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, input: options?.body ? JSON.parse(options.body) : undefined });
    return Response.json(options?.method === "POST" ? { ok: true } : { accounts });
  });
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = useGitAccounts(); return () => null; } });
  app.mount({});
  t.after(() => app.unmount());
  await setImmediate();
  return { state, requests };
}

test("official host choices match HTTPS/SSH addresses and the verification provider without sending requests on selection", async t => {
  const { state, requests } = await fixture(t);
  state.edit();
  assert.equal(state.hostPreset.value, "github");
  for (const [id, hostname] of [["github", "github.com"], ["gitee", "gitee.com"], ["gitlab", "gitlab.com"]]) {
    const count = requests.length;
    state.selectHostPreset(id);
    assert.equal(state.form.host, `https://${hostname}`);
    state.form.authType = "ssh"; state.changeAuthType();
    assert.equal(state.form.host, hostname);
    state.form.authType = "http"; state.changeAuthType();
    assert.equal(state.form.host, `https://${hostname}`);
    assert.equal(requests.length, count);
    state.provider.value = "gitea";
    Object.assign(state.form, { name: "Fixture", username: "developer", password: "fixture-token" });
    await state.verify();
    assert.equal(requests.at(-1).url, "/api/account/git-accounts/verify");
    assert.equal(requests.at(-1).input.provider, id, "an official host cannot use a stale custom service selection");
    assert.equal(requests.at(-1).input.host, `https://${hostname}`);
  }
});

test("custom addresses retain drafts, ports and explicit service types without being rewritten as official hosts", async t => {
  const { state, requests } = await fixture(t);
  state.edit(); state.selectHostPreset("custom");
  state.form.host = "http://git.example.test:3000";
  state.provider.value = "gitea";
  state.selectHostPreset("github"); state.selectHostPreset("custom");
  assert.equal(state.form.host, "http://git.example.test:3000");
  assert.equal(state.provider.value, "gitea");
  Object.assign(state.form, { name: "Custom", username: "developer", password: "fixture-token" });
  await state.verify();
  assert.equal(requests.at(-1).input.provider, "gitea");
  assert.equal(requests.at(-1).input.host, "http://git.example.test:3000");
  for (const host of ["https://github.com:8443", "http://github.com", "https://github.com/team", "https://developer@github.com", "https://github.com?query=1", "https://github.com#fragment", "https://github.com.evil.test"]) {
    state.form.host = host;
    assert.equal(state.officialHost.value, undefined, host);
  }
  state.form.host = "git.example.test:2222";
  state.form.authType = "ssh"; state.changeAuthType();
  assert.equal(state.form.host, "git.example.test:2222");
});

test("editing preserves saved host identity and only saved HTTP credentials can satisfy a blank HTTP password", async t => {
  const http = { id: "http", name: "Saved", host: "https://GitHub.com:443/", authType: "http", username: "developer", revision: 1 };
  const ssh = { id: "ssh", name: "SSH", host: "github.com", authType: "ssh", username: "developer", publicKey: "fixture-public", revision: 1 };
  const { state, requests } = await fixture(t, [http, ssh]);
  state.edit(http);
  assert.equal(state.hostPreset.value, "github");
  assert.equal(state.form.host, http.host, "opening the editor does not rewrite persisted addresses");
  assert.equal(state.hasSavedHttpCredential.value, true);
  await state.verify();
  assert.equal(requests.at(-1).input.provider, "github");
  assert.equal(requests.at(-1).input.password, undefined);
  state.edit(ssh);
  state.form.authType = "http"; state.changeAuthType();
  assert.equal(state.hasSavedHttpCredential.value, false);
  assert.ok(!state.ready.value, "switching from SSH requires a new HTTP credential");
});
