import { expect, test } from "@playwright/test";

test("first run previews and applies an isolated safe manifest", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Your agent control center." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview manifest" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Preview manifest" }).click();
  const result = page.locator("#sync-result");
  await expect(result).toContainText(
    "0 package(s), 0 file target(s), 0 MCP plan(s)",
  );

  const acknowledgement = page.getByLabel(
    "I reviewed this safe plan and want to apply it.",
  );
  await expect(acknowledgement).toBeEnabled();
  await acknowledgement.check();

  const apply = page.getByRole("button", { name: "Apply safe plan" });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(result).toContainText("Synchronized successfully.");
  await expect(acknowledgement).toBeDisabled();
  await expect(apply).toBeDisabled();
});
