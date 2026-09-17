/*
 * One-time local bootstrap. Playwright is used only to copy an already logged
 * in TAPD session into a Git-ignored local file. Later reads use plain HTTP.
 */
const { chromium } = require('playwright');
const { saveSession } = require('./tapd_auth_utils.cjs');
const { argument, configPath } = require('./config.cjs');

const outputPath = configPath(argument('--output') || argument('--config'));
const cdpUrl = process.env.TAPD_CDP_URL || 'http://127.0.0.1:9222';

async function main() {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0];
    const page = context
      .pages()
      .find((candidate) => candidate.url().includes('tapd.cn/tapd_fe/my/work'));
    if (!page)
      throw new Error(
        'No TAPD ‘我的工作’ page is available through Chrome CDP.',
      );

    // Reload starts from the default tab; choosing 待办 produces the exact
    // request template used by this account's current TAPD UI.
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
    await page.getByText('待办', { exact: true }).click();
    const response = await responsePromise;
    const cookies = await context.cookies('https://www.tapd.cn');
    const session = {
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
    const saved = saveSession(session, outputPath);
    process.stdout.write(`Saved local TAPD configuration to ${saved}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`TAPD session bootstrap failed: ${error.message}\n`);
  process.exit(1);
});
