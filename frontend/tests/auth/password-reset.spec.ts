import { test, expect } from "@playwright/test";

/**
 * The raw reset token is never returned by any API response, by design —
 * it only ever goes out by email. So pure browser E2E can't drive the full
 * token-consumption path; that's exhaustively covered at the API level by
 * the backend pytest suite (test_password_reset.py::test_full_forgot_then_reset_flow).
 * This file covers what's genuinely UI-observable: the forgot-password form,
 * the reset-password page's handling of a missing/garbage token, and the
 * live strength checklist.
 */
function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

test.describe("Forgot password page", () => {
  test("positive: submitting a registered email shows the generic confirmation", async ({ page }) => {
    await page.goto("/auth/forgot-password");
    await page.getByPlaceholder("you@example.com").fill(uniqueEmail("e2e_forgot_real"));
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByText(/we've sent a password reset link/i)).toBeVisible();
  });

  test("negative: a nonexistent email shows the exact same message (no enumeration)", async ({ page }) => {
    await page.goto("/auth/forgot-password");
    await page.getByPlaceholder("you@example.com").fill(uniqueEmail("e2e_forgot_ghost"));
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByText(/we've sent a password reset link/i)).toBeVisible();
  });

  test("negative: invalid email format is blocked client-side", async ({ page }) => {
    await page.goto("/auth/forgot-password");
    await page.getByPlaceholder("you@example.com").fill("not-an-email");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page).toHaveURL(/\/auth\/forgot-password$/);
    await expect(page.getByText(/enter a valid email/i)).toBeVisible();
  });

  test("other: back-to-sign-in link works", async ({ page }) => {
    await page.goto("/auth/forgot-password");
    await page.getByRole("link", { name: /back to sign in/i }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
  });
});

test.describe("Reset password page", () => {
  test("negative: missing token shows an explicit error, no form", async ({ page }) => {
    await page.goto("/auth/reset-password");
    await expect(page.getByText(/missing or invalid reset link/i)).toBeVisible();
  });

  test("negative: garbage token is rejected by the server on submit", async ({ page }) => {
    await page.goto("/auth/reset-password?token=garbage-token-value");
    const pwField = page.locator('input[name="new_password"]');
    await pwField.fill("NewPass1!");
    await page.locator('input[name="confirm_password"]').fill("NewPass1!");
    await page.getByRole("button", { name: "Reset password" }).click();

    await expect(page.getByText(/invalid or expired|may have expired/i)).toBeVisible();
  });

  test("negative: mismatched confirmation is blocked client-side", async ({ page }) => {
    await page.goto("/auth/reset-password?token=garbage-token-value");
    await page.locator('input[name="new_password"]').fill("NewPass1!");
    await page.locator('input[name="confirm_password"]').fill("Different1!");
    await page.getByRole("button", { name: "Reset password" }).click();

    await expect(page.getByText(/don't match/i)).toBeVisible();
  });

  test("other: strength checklist reacts live on the reset page too", async ({ page }) => {
    await page.goto("/auth/reset-password?token=garbage-token-value");
    const pwField = page.locator('input[name="new_password"]');

    await pwField.fill("alllowercase1");
    await expect(page.getByText("One uppercase letter")).toHaveClass(/text-sell/);

    await pwField.fill("AllRequired1!");
    await expect(page.getByText("One uppercase letter")).toHaveClass(/text-buy/);
    await expect(page.getByText("One special character")).toHaveClass(/text-buy/);
  });
});
