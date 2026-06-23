import { test, expect } from "@playwright/test";

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

test.describe("Register page", () => {
  test("positive: valid registration redirects to login", async ({ page }) => {
    const email = uniqueEmail("e2e_register");
    await page.goto("/auth/register");

    await page.getByPlaceholder("Jane Smith").fill("E2E Test User");
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.locator('input[type="password"]').fill("GoodPass1!");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/auth\/login$/);
  });

  test("negative: duplicate email shows an error and stays on the page", async ({ page }) => {
    const email = uniqueEmail("e2e_dupe");

    // First registration succeeds.
    await page.goto("/auth/register");
    await page.getByPlaceholder("Jane Smith").fill("First User");
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.locator('input[type="password"]').fill("GoodPass1!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);

    // Second registration with the same email fails, in-page.
    await page.goto("/auth/register");
    await page.getByPlaceholder("Jane Smith").fill("Second User");
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.locator('input[type="password"]').fill("GoodPass1!");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/auth\/register$/);
    await expect(page.getByText(/already registered/i)).toBeVisible();
  });

  test("negative: weak password is blocked client-side before any request", async ({ page }) => {
    await page.goto("/auth/register");
    await page.getByPlaceholder("Jane Smith").fill("Weak Pw User");
    await page.getByPlaceholder("you@example.com").fill(uniqueEmail("e2e_weak"));
    await page.locator('input[type="password"]').fill("weak");
    await page.getByRole("button", { name: "Create account" }).click();

    // Zod blocks the submit client-side — still on register, never reaches the API.
    await expect(page).toHaveURL(/\/auth\/register$/);
  });

  test("other: password strength checklist reacts live as the user types", async ({ page }) => {
    await page.goto("/auth/register");
    const pwField = page.locator('input[type="password"]');

    await pwField.fill("a");
    await expect(page.getByText("At least 8 characters")).toHaveClass(/text-gray-500/);

    await pwField.fill("Abcdefg1!");
    await expect(page.getByText("At least 8 characters")).toHaveClass(/text-buy/);
    await expect(page.getByText("One uppercase letter")).toHaveClass(/text-buy/);
    await expect(page.getByText("One lowercase letter")).toHaveClass(/text-buy/);
    await expect(page.getByText("One digit")).toHaveClass(/text-buy/);
    await expect(page.getByText("One special character")).toHaveClass(/text-buy/);
  });

  test("other: show/hide password toggle switches input type", async ({ page }) => {
    await page.goto("/auth/register");
    const pwField = page.locator('input[type="password"]');
    await pwField.fill("GoodPass1!");
    await expect(pwField).toHaveAttribute("type", "password");

    await page.locator('button[tabindex="-1"]').click();
    await expect(page.locator('input[type="text"]')).toHaveValue("GoodPass1!");
  });

  test("boundary: very long full name is accepted", async ({ page }) => {
    const email = uniqueEmail("e2e_longname");
    const longName = "A".repeat(200);

    await page.goto("/auth/register");
    await page.getByPlaceholder("Jane Smith").fill(longName);
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.locator('input[type="password"]').fill("GoodPass1!");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/auth\/login$/);
  });
});
