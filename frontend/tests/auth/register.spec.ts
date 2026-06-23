import { test, expect } from "@playwright/test";

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function fillPasswords(page: import("@playwright/test").Page, password: string, confirm = password) {
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm_password"]').fill(confirm);
}

test.describe("Register page", () => {
  test("positive: valid registration redirects to login", async ({ page }) => {
    const email = uniqueEmail("e2e_register");
    await page.goto("/auth/register");

    await page.getByPlaceholder("Jane Smith").fill("E2E Test User");
    await page.getByPlaceholder("you@example.com").fill(email);
    await fillPasswords(page, "GoodPass1!");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/auth\/login$/);
  });

  test("negative: duplicate email shows an error and stays on the page", async ({ page }) => {
    const email = uniqueEmail("e2e_dupe");

    // First registration succeeds.
    await page.goto("/auth/register");
    await page.getByPlaceholder("Jane Smith").fill("First User");
    await page.getByPlaceholder("you@example.com").fill(email);
    await fillPasswords(page, "GoodPass1!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);

    // Second registration with the same email fails, in-page.
    await page.goto("/auth/register");
    await page.getByPlaceholder("Jane Smith").fill("Second User");
    await page.getByPlaceholder("you@example.com").fill(email);
    await fillPasswords(page, "GoodPass1!");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/auth\/register$/);
    await expect(page.getByText(/already registered/i)).toBeVisible();
  });

  test("negative: weak password is blocked client-side before any request", async ({ page }) => {
    await page.goto("/auth/register");
    await page.getByPlaceholder("Jane Smith").fill("Weak Pw User");
    await page.getByPlaceholder("you@example.com").fill(uniqueEmail("e2e_weak"));
    await fillPasswords(page, "weak");
    await page.getByRole("button", { name: "Create account" }).click();

    // Zod blocks the submit client-side — still on register, never reaches the API.
    await expect(page).toHaveURL(/\/auth\/register$/);
  });

  test("negative: mismatched confirm password is blocked client-side", async ({ page }) => {
    await page.goto("/auth/register");
    await page.getByPlaceholder("Jane Smith").fill("Mismatch User");
    await page.getByPlaceholder("you@example.com").fill(uniqueEmail("e2e_mismatch"));
    await fillPasswords(page, "GoodPass1!", "Different1!");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/auth\/register$/);
    await expect(page.getByText(/don't match/i)).toBeVisible();
  });

  test("other: password strength checklist reacts live as the user types", async ({ page }) => {
    await page.goto("/auth/register");
    const pwField = page.locator('input[name="password"]');

    await pwField.fill("a");
    await expect(page.getByText("At least 8 characters")).toHaveClass(/text-sell/);

    await pwField.fill("Abcdefg1!");
    await expect(page.getByText("At least 8 characters")).toHaveClass(/text-buy/);
    await expect(page.getByText("One uppercase letter")).toHaveClass(/text-buy/);
    await expect(page.getByText("One lowercase letter")).toHaveClass(/text-buy/);
    await expect(page.getByText("One digit")).toHaveClass(/text-buy/);
    await expect(page.getByText("One special character")).toHaveClass(/text-buy/);
  });

  test("other: show/hide toggle switches both password fields together", async ({ page }) => {
    await page.goto("/auth/register");
    const pwField = page.locator('input[name="password"]');
    const confirmField = page.locator('input[name="confirm_password"]');

    await fillPasswords(page, "GoodPass1!");
    await expect(pwField).toHaveAttribute("type", "password");
    await expect(confirmField).toHaveAttribute("type", "password");

    await page.locator('button[tabindex="-1"]').click();
    await expect(pwField).toHaveAttribute("type", "text");
    await expect(confirmField).toHaveAttribute("type", "text");
    await expect(pwField).toHaveValue("GoodPass1!");
  });

  test("boundary: very long full name is accepted", async ({ page }) => {
    const email = uniqueEmail("e2e_longname");
    const longName = "A".repeat(200);

    await page.goto("/auth/register");
    await page.getByPlaceholder("Jane Smith").fill(longName);
    await page.getByPlaceholder("you@example.com").fill(email);
    await fillPasswords(page, "GoodPass1!");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/auth\/login$/);
  });
});
