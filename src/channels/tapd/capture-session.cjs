const { chromium } = require('playwright');

async function captureSession(cdpUrl, browserType = chromium) {
  const browser = await browserType.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0];
    const page = context
      .pages()
      .find((candidate) => candidate.url().includes('tapd.cn/tapd_fe/my/work'));
    if (!page)
      throw new Error(
        'No TAPD ‘我的工作’ page is available through Chrome CDP.',
      );

    // Capture the account's own todo request template from its logged-in page.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    const responsePromise = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            '/api/my_worktable/my_worktable/get_my_worktable_by_page',
          ) && response.request().method() === 'POST',
      { timeout: 30000 },
    );
    const [response] = await Promise.all([
      responsePromise,
      page.getByText('待办', { exact: true }).click(),
    ]);
    const cookies = await context.cookies('https://www.tapd.cn');
    return {
      version: 1,
      saved_at: new Date().toISOString(),
      endpoint: response.request().url(),
      request_body: response.request().postDataJSON(),
      cookie_header: cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; '),
      origin: 'https://www.tapd.cn',
      referer: page.url(),
    };
  } finally {
    await browser.close();
  }
}

module.exports = { captureSession };
