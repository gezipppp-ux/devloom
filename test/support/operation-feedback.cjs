async function dismissOperationMessages(page) {
  const close = page.getByRole('button', { name: '关闭提示', exact: true });
  while (await close.count()) await close.first().click();
}

module.exports = { dismissOperationMessages };
