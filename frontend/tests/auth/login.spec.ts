import { test, expect } from "@playwright/test";

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerUser(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/auth/register");
  await page.getByPlaceholder("Jane Smith").fill("Login Test User");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm_password"]').fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
}

test.describe("Login page", () => {
  test("positive: valid credentials redirect to dashboard", async ({ page }) => {
    const email = uniqueEmail("e2e_login_ok");
    await registerUser(page, email, "GoodPass1!");

    await page.goto("/auth/login");
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.locator('input[name="password"]').fill("GoodPass1!");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("negative: wrong password shows an error and does not navigate", async ({ page }) => {
    const email = uniqueEmail("e2e_login_wrong");
    await registerUser(page, email, "GoodPass1!");

    await page.goto("/auth/login");
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.locator('input[name="password"]').fill("WrongPass1!");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
  });

  test("negative: nonexistent email shows the same generic error", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByPlaceholder("you@example.com").fill(uniqueEmail("e2e_ghost"));
    await page.locator('input[name="password"]').fill("Whatever1!");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
  });

  test("negative: empty form is blocked client-side", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByText(/email is required/i)).toBeVisible();
  });

  test("other: forgot-password link navigates to the recovery page", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByRole("link", { name: /forgot password/i }).click();
    await expect(page).toHaveURL(/\/auth\/forgot-password$/);
  });

  test("other: show/hide password toggle works on login", async ({ page }) => {
    await page.goto("/auth/login");
    await page.locator('input[name="password"]').fill("GoodPass1!");
    await page.locator('button[tabindex="-1"]').click();
    await expect(page.locator('input[name="password"][type="text"]')).toHaveValue("GoodPass1!");
  });
});
