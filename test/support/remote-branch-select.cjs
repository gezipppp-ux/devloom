async function selectRemoteBranch(page, name = "main") {
  const branch = page.getByRole("combobox", { name: "起始分支", exact: true });
  await branch.click();
  await branch.fill(name);
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option").getByText(name, { exact: true }).click();
}

module.exports = { selectRemoteBranch };
