const { navigateWorkspace } = require("../support/browser-navigation.cjs");
/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");
const { png } = require("../support/helpers.cjs");

async function settingsReady(page, workspace, repository, tapdWorkspace) {
  await page.getByRole("heading", { name: `${workspace.name} · 工作区设置` }).waitFor();
  await page.waitForFunction(({ repository, tapdWorkspace }) =>
    document.querySelector('[aria-label="项目代码仓库路径"]')?.textContent === repository &&
    document.querySelector('input[aria-label="TAPD 项目 ID"]')?.value === tapdWorkspace,
  { repository, tapdWorkspace });
  assert.equal(new URL(page.url()).searchParams.get("workspace"), workspace.id);
}

async function holdResponse(page, pattern) {
  let capture;
  const captured = new Promise((resolve) => { capture = resolve; });
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    capture({ route, response });
  }, { times: 1 });
  return { captured };
}

async function releaseResponse(page, pending, marker) {
  await pending.route.fulfill({
    response: pending.response,
    headers: { ...pending.response.headers(), "x-fixture-workspace-response": marker },
  });
  await page.waitForFunction((expected) =>
    window.workspaceNavigationFixture.responses.includes(expected), marker);
}

async function verifyWorkspaceNavigation(page, { workspaceA, workspaceB, repository, output }) {
  let documentRequests = 0;
  const manualUploads = [];
  const onRequest = (request) => {
    if (request.resourceType() === "document") documentRequests++;
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/channels/manual/images"))
      manualUploads.push(request.url());
  };
  page.on("request", onRequest);
  await page.evaluate(() => {
    window.workspaceNavigationFixture = { responses: [] };
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      // Keep responses deliverable after unmount to exercise response/abort races.
      args[1] = { ...args[1], signal: undefined };
      const response = await originalFetch(...args);
      const originalJson = response.json.bind(response);
      response.json = async () => {
        const result = await originalJson();
        const marker = response.headers.get("x-fixture-workspace-response");
        if (marker) window.setTimeout(() => window.workspaceNavigationFixture.responses.push(marker), 0);
        return result;
      };
      return response;
    };
  });
  const select = workspace => navigateWorkspace(page, workspace);
  const checkUrl = async (workspace) => {
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("workspace"), workspace.id);
    assert.equal(url.searchParams.get("fixture"), "keep-query");
    assert.equal(url.hash, "#keep-fragment");
    assert.equal(await page.evaluate(() => window.history.state.fixture), "keep-state");
    assert.equal(await page.evaluate(() => Boolean(window.workspaceNavigationFixture)), true,
      "switching must retain the same browser document");
  };
  try {
    await settingsReady(page, workspaceA, repository, "42");
    const initialHistoryLength = await page.evaluate(() => window.history.length);
    await select(workspaceA);
    assert.equal(await page.evaluate(() => window.history.length), initialHistoryLength);
    await page.getByLabel("TAPD Cookie", { exact: true }).fill("dsc-token=private-unsaved-draft");
    const origin = new URL(page.url()).origin;
    const auth = await (await page.request.get(`${origin}/api/auth/session`)).json();
    for (const [workspaceId, unreadRunKeys] of [[workspaceA.id, ["workspace-a-unread"]], [workspaceB.id, ["expired-b-unread"]]])
      await page.request.post(`${origin}/api/account/preferences`, { headers: { origin, "x-tapd-token": auth.token }, data: { workspaceId, unreadRunKeys } });
    const prunedPreference = page.waitForResponse((response) => response.url().endsWith("/api/account/preferences") && response.request().method() === "POST");
    await select(workspaceB);
    await settingsReady(page, workspaceB, repository, "");
    await checkUrl(workspaceB);
    assert.equal(await page.getByLabel("TAPD Cookie", { exact: true }).inputValue(), "");
    await prunedPreference;
    const unread = await Promise.all([workspaceA, workspaceB].map(async (workspace) =>
      (await (await page.request.get(`${origin}/api/account/preferences?workspaceId=${workspace.id}`)).json()).preferences.unreadRunKeys));
    assert.deepEqual(unread, [["workspace-a-unread"], []],
    "refreshing B must clear only B's obsolete unread results");
    assert.equal(await page.evaluate(() => window.history.length), initialHistoryLength + 1);
    await page.goBack();
    await settingsReady(page, workspaceA, repository, "42");
    await checkUrl(workspaceA);
    await page.goForward();
    await settingsReady(page, workspaceB, repository, "");
    await checkUrl(workspaceB);

    await select(workspaceA);
    await settingsReady(page, workspaceA, repository, "42");
    const delayedBootstrap = await holdResponse(page, `**/api/workspaces/${workspaceB.id}/bootstrap`);
    await select(workspaceB);
    const oldBootstrap = await delayedBootstrap.captured;
    await page.getByRole("heading", { name: "正在加载工作区…", exact: true }).waitFor();

    assert.equal(await page.getByLabel("项目代码仓库", { exact: true }).count(), 0,
      "loading another workspace must not expose the previous workspace's form");
    assert.equal(await page.getByRole("button", { name: "＋ 从需求启动", exact: true }).isDisabled(), true);
    await checkUrl(workspaceB);
    await page.screenshot({ path: path.join(output, "workspace-switch-loading.png"), fullPage: true });
    await select(workspaceA);
    await settingsReady(page, workspaceA, repository, "42");
    await releaseResponse(page, oldBootstrap, "old-bootstrap");
    await settingsReady(page, workspaceA, repository, "42");
    await checkUrl(workspaceA);

    await page.getByRole("button", { name: "＋ 从需求启动", exact: true }).click();
    await page.getByLabel("需求渠道", { exact: true }).selectOption("manual");
    await page.getByLabel("需求标题", { exact: true }).fill("只属于项目 A 的未提交草稿");
    const delayedUpload = await holdResponse(page, `**/api/workspaces/${workspaceA.id}/channels/manual/images`);
    await page.getByLabel("需求图片", { exact: true }).setInputFiles([
      { name: "第一张.png", mimeType: "image/png", buffer: png },
      { name: "第二张.png", mimeType: "image/png", buffer: png },
    ]);
    const oldUpload = await delayedUpload.captured;
    await select(workspaceB);
    await settingsReady(page, workspaceB, repository, "");
    await releaseResponse(page, oldUpload, "old-manual-upload");
    await page.getByRole("button", { name: "＋ 从需求启动", exact: true }).click();
    await page.getByLabel("需求渠道", { exact: true }).selectOption("manual");
    assert.equal(await page.getByLabel("需求标题", { exact: true }).inputValue(), "");
    assert.equal(await page.locator(".manual-images img").count(), 0);
    await select(workspaceA);
    await settingsReady(page, workspaceA, repository, "42");
    assert.deepEqual(manualUploads, [`${new URL(page.url()).origin}/api/workspaces/${workspaceA.id}/channels/manual/images`],
      "leaving during a multi-image upload must stop before uploading remaining files to any workspace");
    await checkUrl(workspaceA);
    assert.equal(documentRequests, 0, "workspace switching and browser history must not reload the document");
  } finally {
    page.off("request", onRequest);
  }
}

module.exports = { verifyWorkspaceNavigation };
