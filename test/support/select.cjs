const { openAccountMenu } = require('./browser-navigation.cjs');
async function selectRoot(control) {
  return (await control.evaluate((el) => el.classList.contains("app-select")))
    ? control
    : control.locator(
        "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' app-select ')][1]",
      );
}
async function selectValue(control) {
  return JSON.parse(
    await (await selectRoot(control)).getAttribute("data-value"),
  );
}
async function selectOptions(control) {
  const root = await selectRoot(control);
  await root.locator(".ant-select").click();
  const popup = control.page().locator(".app-select-popup:visible").last();
  await popup.waitFor();
  const options = await popup
    .locator(".app-select-option")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        value: node.dataset.value,
        label: node.querySelector(".app-select-option-copy > span").textContent,
      })),
    );
  await root.getByRole("combobox").press("Escape");
  await popup.waitFor({ state: "hidden" });
  return options;
}
async function selectOption(control, choice) {
  const root = await selectRoot(control);
  const trigger = root.getByRole("combobox");
  const multiple = (await root.locator(".ant-select-multiple").count()) > 0;
  const desired = Array.isArray(choice) ? choice : [choice];
  const previous = multiple ? await selectValue(control) : [];
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await root.locator(".ant-select").click();
  const popup = control.page().locator(".app-select-popup:visible").last();
  await popup.waitFor();
  const click = async (value) => {
    if (typeof value === "object")
      await popup
        .getByRole("option", { name: value.label, exact: true })
        .click();
    else
      await popup
        .locator(
          `.app-select-option[data-value=${JSON.stringify(String(value))}]`,
        )
        .click();
  };
  if (multiple)
    for (const value of previous)
      if (!desired.includes(value)) await click(value);
  for (const value of desired)
    if (!multiple || !previous.includes(value)) await click(value);
  if (multiple) await trigger.press("Escape");
  await popup.waitFor({ state: "hidden" });
}
async function selectPreference(page, name, choice) {
  await openAccountMenu(page);
  await selectOption(page.locator(name === 'locale' ? '.ui-locale' : '.ui-theme-select'), choice);
  if (await page.locator('.ui-account-menu').isVisible()) {
    await page.keyboard.press('Escape');
    await page.locator('.ui-account-menu').waitFor({ state: 'hidden' });
  }
}
module.exports = { selectOption, selectValue, selectOptions, selectPreference };
