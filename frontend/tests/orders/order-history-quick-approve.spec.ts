import { test, expect, Page, Route } from "@playwright/test";

// Order History's Action column calls the unified /signals/orders/{id}/
// approve|reject endpoints (asset_type-aware on the backend, dispatching
// to options or equity execution) — every call is mocked here, only auth
// runs against the real backend.

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndLogin(page: Page) {
  const email = uniqueEmail("e2e_quick_approve");
  const password = "GoodPass1!";

  await page.goto("/auth/register");
  await page.getByPlaceholder("Jane Smith").fill("Quick Approve Test User");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm_password"]').fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);

  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

function order(overrides: Record<string, unknown>) {
  return {
    id: "order-mock-1",
    ticker: "AAPL",
    side: "buy",
    quantity: 1,
    status: "pending_approval",
    is_automated: false,
    rejection_reason: null,
    asset_type: "option",
    option_right: "call",
    avg_fill_price: null,
    exit_price: null,
    stop_price: null,
    take_profit_price: null,
    submitted_at: null,
    filled_at: null,
    created_at: new Date().toISOString(),
    closed_at: null,
    pnl_usd: null,
    pnl_pct: null,
    ...overrides,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test.describe("Order History quick approve", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
  });

  test("positive: Approve button on a pending_approval row calls approve and refreshes to filled", async ({ page }) => {
    let approved = false;
    await page.route("**/api/v1/signals/orders**", (route) => {
      const pending = order({ id: "order-mock-1" });
      const filled = order({ id: "order-mock-1", status: "filled", avg_fill_price: 5.7, submitted_at: new Date().toISOString(), filled_at: new Date().toISOString() });
      return fulfillJson(route, [approved ? filled : pending]);
    });
    const approvePromise = page.waitForRequest(
      (req) => req.url().includes("/signals/orders/order-mock-1/approve") && req.method() === "POST"
    );
    await page.route("**/api/v1/signals/orders/order-mock-1/approve", (route) => {
      approved = true;
      return fulfillJson(route, order({ id: "order-mock-1", status: "filled" }));
    });

    await page.goto("/orders");
    await expect(page.getByText("pending_approval")).toBeVisible();

    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await approvePromise;

    await expect(page.getByText("filled")).toBeVisible();
    await expect(page.getByText("pending_approval")).not.toBeVisible();
  });

  test("positive: Reject button calls reject", async ({ page }) => {
    await page.route("**/api/v1/signals/orders**", (route) => fulfillJson(route, [order({})]));
    const rejectPromise = page.waitForRequest(
      (req) => req.url().includes("/signals/orders/order-mock-1/reject") && req.method() === "POST"
    );
    await page.route("**/api/v1/signals/orders/order-mock-1/reject", (route) =>
      fulfillJson(route, order({ status: "cancelled", rejection_reason: "Rejected by user" }))
    );

    await page.goto("/orders");
    await page.locator("tr", { hasText: "AAPL" }).getByRole("button").last().click();
    await rejectPromise;
  });

  test("negative: filled orders show no action buttons", async ({ page }) => {
    await page.route("**/api/v1/signals/orders**", (route) =>
      fulfillJson(route, [order({ status: "filled", avg_fill_price: 5.7 })])
    );

    await page.goto("/orders");
    await expect(page.getByText("filled")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  });
});
