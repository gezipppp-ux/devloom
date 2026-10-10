/* global document, window */
const assert = require('node:assert/strict');
const path = require('node:path');

const longRequirement = Array.from({ length: 160 }, (_, index) =>
  `第 ${index + 1} 条验收内容：保留完整需求和会话记录，滚动后仍可查看后续回复。 https://example.invalid/${'long-path-'.repeat(12)}`,
).join('\n');

async function verifySessionScroll(browser, origin, manager, key, errors, output) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 911 } });
  page.on('pageerror', (error) => errors.push(error.message));
  const items = [
    { id: 'scroll-user', type: 'userMessage', text: longRequirement },
    { id: 'scroll-reply', type: 'agentMessage', text: '长需求后的回复', status: 'completed' },
  ];
  await page.route('**/api/runs', (route) => route.fulfill({ json: {
    runs: [{ key, title: '超长需求滚动回归', status: 'completed' }],
  } }));
  await page.route(`**/api/runs/${key}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), items, nextCursor: null } });
  });
  const timeline = page.locator('.timeline');
  const gap = () => timeline.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);
  const atBottom = () => page.waitForFunction(() => {
    const el = document.querySelector('.timeline');
    return el && Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) <= 1;
  }, null, { timeout: 2000 });
  function publish(item) {
    const index = items.findIndex(entry => entry.id === item.id);
    if (index < 0) items.push(item);
    else items[index] = item;
    // Only fixture SSE; no Codex turn or external requirement is executed.
    manager.publish(manager.sessions.get(key), { type: 'item', item });
  }
  async function stream(text) {
    publish({ id: 'scroll-stream', type: 'agentMessage', text, status: 'inProgress' });
    await page.waitForFunction(value =>
      document.querySelector('.message-markdown:last-of-type') &&
      [...document.querySelectorAll('.message-markdown')].some(el => el.textContent.includes(value)),
    text.split('\n').at(-1));
  }
  try {
    for (const width of [1920, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 911 });
      await page.goto(origin);
      await page.locator('.timeline[aria-busy="false"]').waitFor();
      await atBottom();
      assert.ok(await timeline.evaluate(el => el.scrollHeight > el.clientHeight * 3),
        'the fixture must exceed several screens');

      const added = { id: `scroll-added-${width}`, type: 'userMessage', text: `追加长需求 ${width}\n${longRequirement}` };
      publish(added);
      await page.getByText(added.text, { exact: true }).waitFor();
      await atBottom().catch(async () => {
        assert.fail(`adding a long requirement must retain the bottom at ${width}px; gap=${await gap()}`);
      });

      // A single streaming update grows by much more than the follow threshold.
      const reply = `## 长回复 ${width}\n\n${'验收结果继续补充。\n\n'.repeat(45)}流式结尾 ${width}`;
      await stream(reply);
      await atBottom();
      await page.screenshot({ path: path.join(output, `session-scroll-bottom-${width}.png`), fullPage: true });

      // Reading an earlier part of the long requirement must not be interrupted.
      await timeline.evaluate(el => el.scrollTo({ top: 300, behavior: 'instant' }));
      const readingTop = await timeline.evaluate(el => el.scrollTop);
      await stream(`${reply}\n\n上翻期间新增 ${width}`);
      assert.ok(Math.abs(await timeline.evaluate(el => el.scrollTop) - readingTop) <= 1,
        'streamed content must preserve the position while reading history');
      await page.screenshot({ path: path.join(output, `session-scroll-reading-${width}.png`), fullPage: true });

      // Returning near the bottom resumes following, including rapid deltas.
      await timeline.evaluate(el => el.scrollTo({ top: el.scrollHeight - el.clientHeight - 100, behavior: 'instant' }));
      for (let index = 0; index < 5; index++) {
        await stream(`${reply}\n\n${'补充回复。\n\n'.repeat(index + 1)}连续更新 ${width}-${index}`);
        await atBottom();
      }
      assert.equal(await page.evaluate(() => {
        const el = document.querySelector('.timeline');
        return el.scrollWidth > el.clientWidth + 2 || document.documentElement.scrollWidth > window.innerWidth + 2;
      }), false, 'long requirements must not cause horizontal page overflow');
    }
    process.stdout.write('Long-session scrolling passed: initial history, long additions, large stream updates, reading position and responsive widths.\n');
  } finally {
    await page.close();
  }
}

module.exports = { verifySessionScroll };
