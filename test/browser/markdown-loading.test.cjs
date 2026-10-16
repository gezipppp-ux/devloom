const assert = require("node:assert/strict");

async function verifyMarkdownLoading({ browser, origin }) {
  for (const failure of [false, true]) {
    const context = await browser.newContext({ locale: "zh-CN" });
    const page = await context.newPage();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route("**/src/shared/components/VisualMarkdownEditor.vue*", async route => {
      await gate;
      if (failure) await route.abort("failed");
      else await route.continue();
    });
    try {
      await page.goto(origin + "/fixture?fixture=editor");
      const fields = page.locator(".markdown-editor");
      await fields.first().locator(".markdown-editor-loading").waitFor();
      assert.equal(await fields.count(), 3);
      for (const field of await fields.all()) {
        assert.ok((await field.locator(".markdown-editor-loading").boundingBox()).height >= 160, "pending editors retain a writing canvas");
      }
      const description = fields.first();
      await description.getByRole("button", { name: "Markdown源码", exact: true }).click();
      await description.locator("textarea").fill("加载期间保留的草稿");
      release();
      await description.getByRole("button", { name: "写作", exact: true }).click();
      if (failure) {
        await description.locator(".markdown-editor-load-error").waitFor();
        assert.equal(await description.locator("textarea").inputValue(), "加载期间保留的草稿");
        await description.locator("textarea").fill("加载失败仍能写作");
        assert.ok(await description.getByRole("button", { name: "添加附件", exact: true }).isEnabled());
      } else {
        const content = description.locator('[contenteditable="true"]');
        await content.waitFor();
        assert.ok((await content.boundingBox()).height >= 160);
        assert.equal(await content.innerText(), "加载期间保留的草稿");
        await content.fill("加载完成后继续写作");
      }
      await description.getByRole("button", { name: "预览", exact: true }).click();
      await description.getByRole("button", { name: "Markdown源码", exact: true }).click();
      assert.equal(await description.locator("textarea").inputValue(), failure ? "加载失败仍能写作" : "加载完成后继续写作");
    } finally { release(); await context.close(); }
  }
}

module.exports = { verifyMarkdownLoading };
