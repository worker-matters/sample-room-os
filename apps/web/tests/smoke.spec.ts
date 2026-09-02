import { expect, test } from "@playwright/test";

test("renders the V2 shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Sample Room OS")).toBeVisible();
  await expect(page.getByText("开发测试模式")).toBeVisible();
  await expect(page.getByText("人工测试流程")).toBeVisible();
});
