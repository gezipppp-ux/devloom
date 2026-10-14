/* global atob, ClipboardEvent, DataTransfer, File, Uint8Array, document */
const assert = require("node:assert/strict");
const path = require("node:path");

const imageBase64 = "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";
const markdown = "## 浏览器 Markdown 验证\n\n- 可重复验证列表\n\n```js\nconst verified = true;\n```\n\n| 字段 | 结果 |\n| --- | --- |\n| 保存 | 成功 |\n\n![远程图片](https://invalid.example/remote.png)\n\n<script>window.issueXss = true</script>\n<img src=x onerror=window.issueXss=true>\n[危险链接](javascript:alert(1))";

function editor(page, label = "描述") { return page.getByRole("group", { name: `${label}编辑器`, exact: true }); }
async function source(page, label = "描述") {
  const field = editor(page, label);
  await field.getByRole("button", { name: "Markdown源码", exact: true }).click();
  return field.locator("textarea");
}
async function setMarkdown(page, label, value) { await (await source(page, label)).fill(value); await visual(page, label); }
async function markdownValue(page, label = "描述") { const value = await (await source(page, label)).inputValue(); await visual(page, label); return value; }
async function visual(page, label = "描述") {
  const field = editor(page, label);
  await field.getByRole("button", { name: "写作", exact: true }).click();
  return field.locator('[contenteditable="true"]');
}

async function pasteImage(page, label = "描述", name = "pasted-proof.png", plain = "") {
  const content = await visual(page, label);
  await content.click();
  await content.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await content.evaluate((element, { data, name, plain }) => {
    const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type: "image/png" }));
    if (plain) { transfer.setData("text/plain", plain); transfer.setData("text/html", `<b>${plain}</b><img src="https://invalid.example/clipboard.png" onerror="window.issueXss=true">`); }
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, { data: imageBase64, name, plain });
  await content.locator(`img[alt="${name}"]`).waitFor();
  assert.doesNotMatch(await content.innerText(), /\/api\/projects\//, "visual writing hides attachment UUID URLs");
  if (plain) assert.equal((await content.innerText()).split(plain).length - 1, 1, "mixed image and rich-text clipboard inserts its plain text exactly once");
}

async function verifyVisualWriting(page) {
  const content = await visual(page);
  await content.locator('img[alt="pasted-proof.png"]').click();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.insertText("图片前的补充说明");
  assert.equal(await content.locator('img[alt="pasted-proof.png"]').count(), 1, "typing before the image preserves it");
  await page.keyboard.press("Enter");
  await content.locator('img[alt="pasted-proof.png"]').click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  assert.equal(await content.locator('img[alt="pasted-proof.png"]').count(), 1, "enter after the image preserves it");
  const ime = await page.context().newCDPSession(page);
  await ime.send("Input.imeSetComposition", { text: "图片后的中文输入", selectionStart: 9, selectionEnd: 9 });
  await ime.send("Input.insertText", { text: "图片后的中文输入" });
  await ime.detach();
  assert.match(await content.innerText(), /图片后的中文输入/);
  assert.equal(await content.locator('img[alt="pasted-proof.png"]').count(), 1, "typing beside the image preserves it");
  await page.keyboard.press("ControlOrMeta+z");
  assert.doesNotMatch(await content.innerText(), /图片后的中文输入/);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  assert.match(await content.innerText(), /图片后的中文输入/);
  assert.equal(await content.locator('img[alt="pasted-proof.png"]').count(), 1, "redo restores the image together with text");
  await content.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "富文本剪贴板说明\n第二行文字");
    transfer.setData("text/html", '<b>富文本剪贴板说明</b><p>第二行文字</p><script>window.issueXss=true</script><img src="https://invalid.example/clipboard.png">');
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  assert.match(await content.innerText(), /富文本剪贴板说明/);
  assert.match(await content.innerText(), /第二行文字/);
  assert.equal(await content.locator('img[alt="pasted-proof.png"]').count(), 1, "rich-text paste preserves the preceding image");
  assert.equal(await content.locator('script, [onerror], img[src^="https:"]').count(), 0);
  const value = await markdownValue(page);
  assert.match(value, /图片前的补充说明/);
  assert.match(value, /图片后的中文输入/);
  assert.match(value, /!\[pasted-proof\.png\]\(\/api\/projects\//);
  assert.ok(value.indexOf("图片前的补充说明") < value.indexOf("![pasted-proof.png]"), "typing before the image stays before it");
  assert.ok(value.indexOf("图片后的中文输入") > value.indexOf("![pasted-proof.png]"), "typing after the image stays after it");
  const restored = await visual(page);
  await restored.locator('img[alt="pasted-proof.png"]').waitFor();
  assert.doesNotMatch(await restored.innerText(), /\/api\/projects\//);
  await restored.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+x");
  assert.equal((await restored.innerText()).trim(), "", "cut removes the selected document");
  await page.keyboard.press("ControlOrMeta+v");
  await restored.locator('img[alt="pasted-proof.png"]').waitFor();
  assert.equal(await markdownValue(page), value, "native same-editor cut/paste preserves the document and its persistent image identity");
}

async function captureEditor(page, output, prefix) {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${prefix} overflow at ${width}`);
    await page.getByRole("button", { name: "保存事项", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${prefix}-${width}.png`), fullPage: true });
    if (width === 1440 || width === 390) await editor(page).screenshot({ path: path.join(output, `visual-editor-${prefix}-${width === 1440 ? "desktop" : "mobile"}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

module.exports = { imageBase64, markdown, editor, source, setMarkdown, markdownValue, visual, pasteImage, verifyVisualWriting, captureEditor };
