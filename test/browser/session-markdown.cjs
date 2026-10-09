/* global document, window */
const assert = require('node:assert/strict');
const { messageMarkdown } = require('../fixtures/message-markdown.cjs');

async function verifySessionMarkdown(browser, origin, client, key, errors) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const remoteRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://blocked.invalid/**', (route) => {
    remoteRequests.push(route.request().url());
    return route.abort();
  });
  const unsafe = [
    '<script>window.messageXss = 1</script>',
    '<img src="https://blocked.invalid/raw.png" onerror="window.messageXss = 1">',
    '<iframe src="https://blocked.invalid/frame"></iframe>',
    '<a href="javascript:alert(1)" style="position:fixed">HTML 源码</a>',
    '![远程图片](https://blocked.invalid/markdown.png)',
    '![嵌套替代文字 <img src=x onerror=alert(1)>](https://blocked.invalid/nested.png)',
    '[危险脚本](javascript:alert%281%29)',
    '[数据链接](data:text/html,test)',
    '[本地文件](file:///tmp/test)',
    '[相对链接](/api/runs)',
    '[协议相对链接](//blocked.invalid/link)',
    '[邮件](mailto:test@example.invalid)',
    '```html\n<div onclick="alert(1)">& source</div>\n```',
  ].join('\n\n');
  const text = `${messageMarkdown}\n\n${unsafe}`;
  const reply = page.locator('.message-markdown').filter({ hasText: '检查结果' });
  try {
    await page.goto(origin);
    await page.getByText('历史回复', { exact: true }).waitFor();
    // Open and close the fence across separate SSE updates.
    const split = text.indexOf('FROM');
    client.notify('item/agentMessage/delta', {
      turnId: 'markdown-turn', itemId: 'markdown-reply', delta: text.slice(0, split),
    });
    await reply.locator('pre code').waitFor();
    assert.match(await reply.locator('pre code').textContent(), /SELECT migration_name/);
    client.notify('item/agentMessage/delta', {
      turnId: 'markdown-turn', itemId: 'markdown-reply', delta: text.slice(split),
    });
    await reply.getByRole('link', { name: '邮件', exact: true }).waitFor();

    async function verifyContent() {
      await reply.getByRole('heading', { name: '检查结果', level: 2 }).waitFor();
      assert.equal(await reply.locator('strong').textContent(), '历史菜单');
      assert.equal(await reply.locator('ul > li').count(), 3);
      assert.equal(await reply.locator('ul ul > li').count(), 1);
      assert.equal(await reply.locator('ol > li').count(), 2);
      assert.equal(await reply.locator('del').textContent(), '直接删除');
      assert.equal((await reply.locator('blockquote').textContent()).trim(), '先核查记录，再执行后续操作。');
      assert.equal(await reply.locator('table tbody tr').count(), 2);
      assert.equal(await reply.locator('li code').first().textContent(), 'menu:legacy-purchase');
      assert.equal(await reply.locator('pre code').first().textContent(),
        'SELECT migration_name, finished_at\nFROM "_prisma_migrations"\nWHERE migration_name = \'example_menu_migration\';\n');
      assert.equal(await reply.locator('pre code').last().textContent(), '<div onclick="alert(1)">& source</div>\n');
      const safeLink = reply.getByRole('link', { name: '迁移说明', exact: true });
      assert.equal(await safeLink.getAttribute('href'), 'https://example.invalid/migrations');
      assert.equal(await safeLink.getAttribute('target'), '_blank');
      assert.equal(await safeLink.getAttribute('rel'), 'noopener noreferrer');
      assert.equal(await reply.getByRole('link').count(), 2);
      assert.equal(await reply.locator('script, img, iframe, style, [onclick], [onerror], [style]').count(), 0);
      assert.ok((await reply.textContent()).includes('<script>window.messageXss = 1</script>'));
      assert.ok((await reply.textContent()).includes('远程图片'));
      assert.equal(await page.evaluate(() => window.messageXss), undefined);
      assert.deepEqual(remoteRequests, []);
    }
    await verifyContent();
    client.notify('item/completed', {
      turnId: 'markdown-turn', item: { id: 'markdown-reply', type: 'agentMessage', text },
    });
    await reply.locator('xpath=..').locator('.writing').waitFor({ state: 'hidden' });
    await page.reload();
    await verifyContent();

    const literal = '**原样保留**\n<script>window.messageXss = 1</script>';
    client.notify('item/completed', {
      turnId: 'markdown-turn',
      item: { id: 'markdown-user', type: 'userMessage', content: [{ type: 'text', text: literal }] },
    });
    client.notify('item/completed', {
      turnId: 'markdown-turn',
      item: { id: 'markdown-tool', type: 'commandExecution', command: 'fixture-only', aggregatedOutput: literal, exitCode: 0 },
    });
    const user = page.locator('.from-user .message-text').filter({ hasText: '**原样保留**' });
    await user.waitFor();
    assert.equal((await user.textContent()).trim(), literal);
    assert.equal(await user.locator('strong, script').count(), 0);
    const tool = page.locator('.tool-item').filter({ hasText: 'fixture-only' });
    await tool.locator('summary').click();
    assert.equal(await tool.locator('pre').last().textContent(), literal);
    assert.equal(await tool.locator('strong, script').count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector('.timeline').scrollWidth > document.querySelector('.timeline').clientWidth + 2), false);
    process.stdout.write(`Markdown replies passed: streamed fences, history reload, formatting and safe content (${key}).\n`);
  } finally {
    await page.close();
  }
}

module.exports = { verifySessionMarkdown };
