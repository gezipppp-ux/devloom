/* global document, window, navigator, ClipboardItem, ClipboardEvent, DataTransfer, File */
const assert = require('node:assert/strict');
const path = require('node:path');
const { png } = require('../support/helpers.cjs');

async function pasteImages(page, names) {
  return page.getByRole('textbox', { name: '发送给 Codex 的指令' }).evaluate((input, files) => {
    const clipboardData = new DataTransfer();
    for (const { name, bytes } of files)
      clipboardData.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  }, names.map((name) => ({ name, bytes: [...png] })));
}

async function imagesReady(page, count) {
  await page.waitForFunction((expected) => {
    const images = [...document.querySelectorAll('.composer-image-list img')];
    const send = document.querySelector('.composer-send');
    return images.length === expected && images.every((image) => image.complete && image.naturalWidth)
      && send && !send.disabled;
  }, count);
  assert.equal(await page.locator('.composer .ant-form-item-explain-error:visible')
    .filter({ hasText: '请输入指令或添加图片' }).count(), 0,
  'a draft with ready images must not display a stale required-field error');
}

async function verifyLateImageUpload(page, { pattern, leave, reopen, navigation = false }) {
  const input = page.getByRole('textbox', { name: '发送给 Codex 的指令' });
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    let holdFirstImage = true;
    window.processedImageUploads = [];
    window.fetch = async (...args) => {
      // Deliver one response even after selection aborts its request, reproducing
      // the response/abort race without relying on network timing.
      if (holdFirstImage && String(args[0]).endsWith('/message-images')) {
        holdFirstImage = false;
        args[1] = { ...args[1], signal: undefined };
      }
      const response = await originalFetch(...args);
      const originalJson = response.json.bind(response);
      response.json = async () => {
        const result = await originalJson();
        const marker = response.headers.get('x-fixture-image');
        if (marker) window.setTimeout(() => window.processedImageUploads.push(marker), 0);
        return result;
      };
      return response;
    };
  });
  let capture;
  const captured = new Promise((resolve) => { capture = resolve; });
  const handler = async (route) => {
    const response = await route.fetch();
    capture({ route, response });
  };
  await page.route(pattern, handler, { times: 1 });
  await pasteImages(page, ['旧会话上传.png']);
  const oldUpload = await captured;
  await leave();
  if (navigation) {
    // Workspace selection reloads the document, so its pending fetch no longer
    // has a live receiver. Complete it before creating the new document's draft.
    await oldUpload.route.fulfill({ response: oldUpload.response });
  }
  await reopen();
  await input.fill('保留切换后的新草稿');
  assert.equal(await page.locator('.composer-image-list img').count(), 0);
  const freshUpload = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/message-images'));
  await pasteImages(page, ['新会话图片.png']);
  if (!navigation) {
    await oldUpload.route.fulfill({
      response: oldUpload.response,
      headers: { ...oldUpload.response.headers(), 'x-fixture-image': 'old-upload' },
    });
    await page.waitForFunction(() => window.processedImageUploads.includes('old-upload'));
  }
  assert.equal((await freshUpload).url(), oldUpload.response.url(),
    'returning to a session keeps uploads scoped to the same workspace and run');
  await imagesReady(page, 1);
  assert.equal(await input.inputValue(), '保留切换后的新草稿');
  assert.deepEqual(await page.locator('.composer-image-list img').evaluateAll((images) =>
    images.map((image) => image.alt)), ['新会话图片.png']);
  await page.getByRole('button', { name: '移除图片 新会话图片.png', exact: true }).click();
  await input.fill('');
}

async function verifySessionImages(browser, origin, manager, client, key, errors, output) {
  if (manager.sessions.get(key)?.turnId) await manager.interrupt(key);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const uploads = `**/api/runs/${key}/message-images`;
  const messages = `**/api/runs/${key}/messages`;
  const messageRequests = [];
  const uploadResponses = [];
  page.on('response', async (response) => {
    if (response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/message-images'))
      uploadResponses.push({ status: response.status(), body: await response.text().catch(() => '<response unavailable>') });
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === `/api/runs/${key}/messages`)
      messageRequests.push(request.postDataJSON());
  });
  try {
    await page.goto(origin);
    await page.getByText('历史回复', { exact: true }).waitFor();
    const input = page.getByRole('textbox', { name: '发送给 Codex 的指令' });
    const send = page.getByRole('button', { name: '发送 ↑', exact: true });
    const picker = page.getByLabel('选择会话图片', { exact: true });

    // Native paste verifies plain text keeps its normal browser behavior.
    await page.evaluate(() => navigator.clipboard.writeText('普通文本粘贴仍然保留'));
    await input.focus();
    await page.keyboard.press('ControlOrMeta+V');
    await page.waitForFunction(() =>
      document.querySelector('textarea[aria-label="发送给 Codex 的指令"]').value === '普通文本粘贴仍然保留');
    assert.equal(await page.locator('.composer-image-list img').count(), 0);
    await input.fill('');

    // Use a real PNG clipboard entry, as produced by taking a screenshot.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 180;
      canvas.height = 110;
      const drawing = canvas.getContext('2d');
      drawing.fillStyle = '#e4ecdf';
      drawing.fillRect(0, 0, 180, 110);
      drawing.fillStyle = '#254a35';
      drawing.fillRect(12, 12, 50, 86);
      drawing.fillStyle = '#ffffff';
      drawing.fillRect(72, 12, 96, 86);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
    await input.focus();
    await page.keyboard.press('ControlOrMeta+V');
    await imagesReady(page, 1);
    assert.equal(await input.inputValue(), '');
    assert.equal(await pasteImages(page, ['补充截图一.png', '补充截图二.png']), false,
      'image paste must also preserve any native clipboard text');
    await imagesReady(page, 3);
    await page.getByRole('button', { name: '移除图片 补充截图二.png', exact: true }).click();
    await imagesReady(page, 2);

    // File selection is also supported, and upload failures preserve a retryable draft.
    await page.route(uploads, (route) => route.fulfill({
      status: 400, json: { error: '模拟图片上传失败' },
    }), { times: 1 });
    await picker.setInputFiles({ name: '失败后重试.png', mimeType: 'image/png', buffer: png });
    const retry = page.getByRole('button', { name: '重试上传 失败后重试.png', exact: true });
    await retry.waitFor();
    assert.equal(await send.isDisabled(), true);
    await retry.click();
    await imagesReady(page, 3);
    await page.getByRole('button', { name: '移除图片 失败后重试.png', exact: true }).click();

    let capture;
    const captured = new Promise((resolve) => { capture = resolve; });
    await page.route(uploads, (route) => capture(route), { times: 1 });
    await pasteImages(page, ['上传中禁止发送.png']);
    const pendingUpload = await captured;
    await input.fill('上传中仍可编辑文字');
    assert.equal(await send.isDisabled(), true);
    await input.press('Control+Enter');
    assert.equal(messageRequests.length, 0, 'Ctrl+Enter must not send while an image is uploading');
    assert.equal(await input.inputValue(), '上传中仍可编辑文字');
    await pendingUpload.continue();
    await imagesReady(page, 3);
    await page.getByRole('button', { name: '移除图片 上传中禁止发送.png', exact: true }).click();

    const longName = `${'待补充的界面截图'.repeat(10)}.png`;
    await pasteImages(page, [longName]);
    await imagesReady(page, 3);
    for (const [name, width, height] of [
      ['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 390, 844], ['narrow', 320, 740],
    ]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `image attachments must fit the ${width}px viewport`);
      const overflow = await page.locator('.composer-image-list button').evaluateAll((buttons) =>
        buttons.some((button) => {
          const box = button.getBoundingClientRect();
          return box.left < 0 || box.right > window.innerWidth;
        }));
      assert.equal(overflow, false, `image actions must remain reachable at ${width}px`);
      assert.equal(await page.locator('.composer .ant-form-item-explain-error:visible')
        .filter({ hasText: '请输入指令或添加图片' }).count(), 0,
      `a valid image draft must not display a required-field error at ${width}px`);
      await page.screenshot({ path: path.join(output, `session-images-${name}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: `移除图片 ${longName}`, exact: true }).click();

    await page.route(messages, (route) => route.fulfill({
      status: 400, json: { error: '模拟图片消息发送失败' },
    }), { times: 1 });
    await send.click();
    await page.getByText('模拟图片消息发送失败', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), '上传中仍可编辑文字');
    await imagesReady(page, 2);
    await input.fill('');
    await send.click();
    await page.getByRole('button', { name: '■ 停止', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.composer-image-list img').length === 0);
    const first = client.calls.findLast((call) => call.method === 'turn/start');
    assert.equal(first.params.input.filter((item) => item.type === 'localImage').length, 2);
    assert.equal(first.params.input.some((item) => item.type === 'text' && item.text.trim()), false);
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.message-images img')];
      return images.length >= 2 && images.every((image) => image.complete && image.naturalWidth);
    });
    for (const source of await page.locator('.message-images img').evaluateAll((images) => images.map((image) => image.src)))
      assert.ok(source.startsWith(`${origin}/api/runs/${key}/`), 'history uses safe run-scoped image routes');

    await pasteImages(page, ['执行中补充.png']);
    await imagesReady(page, 1);
    await input.fill('请参考这张截图修复界面');
    await page.getByRole('button', { name: '补充指令 ↑', exact: true }).click();
    await page.getByText('补充指令已发送至当前一轮。', { exact: true }).waitFor();
    const steer = client.calls.findLast((call) => call.method === 'turn/steer');
    assert.equal(steer.params.threadId, first.params.threadId);
    assert.equal(steer.params.expectedTurnId, manager.sessions.get(key).turnId);
    assert.equal(steer.params.input.filter((item) => item.type === 'localImage').length, 1);
    assert.equal(steer.params.input.find((item) => item.type === 'text').text, '请参考这张截图修复界面');
    assert.equal(await page.locator('.composer-image-list img').count(), 0);
    await page.getByRole('button', { name: '■ 停止', exact: true }).click();
    await page.getByRole('button', { name: '■ 停止', exact: true }).waitFor({ state: 'hidden' });

    await verifyLateImageUpload(page, {
      pattern: uploads,
      leave: async () => {
        await page.locator('.session-link').filter({ hasText: '修复登录异常' }).click();
        await page.getByRole('heading', { name: '修复登录异常', exact: true }).waitFor();
      },
      reopen: async () => {
        await page.locator('.session-link').filter({ hasText: '【演示】套餐充值入口' }).click();
        await page.getByText('历史回复', { exact: true }).waitFor();
      },
    });
    process.stdout.write('Session images passed: native image/text paste, multiple images, retry, pending upload, failed send, image-only start, image steer, history, responsive layouts and stale session uploads.\n');
  } catch (error) {
    const composer = await page.locator('.composer').evaluate((element) => ({
      text: element.textContent,
      input: element.querySelector('textarea')?.value,
      disabled: element.querySelector('textarea')?.disabled,
      sendDisabled: element.querySelector('.composer-send')?.disabled,
      images: [...element.querySelectorAll('img')].map((image) => ({
        alt: image.alt, complete: image.complete, width: image.naturalWidth,
      })),
    })).catch(() => null);
    process.stderr.write(`Session image diagnostics: ${JSON.stringify({ composer, uploadResponses })}\n`);
    await page.screenshot({ path: path.join(output, 'session-images-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await context.close();
    if (manager.sessions.get(key)?.turnId) await manager.interrupt(key);
  }
}

module.exports = { verifySessionImages, verifyLateImageUpload };
