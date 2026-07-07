import { test, expect, Page, Route } from "@playwright/test";

// Wizard saves a real AutomationConfig, so every broker/signal call is
// mocked here — only auth runs against the real backend, same discipline
// as the other mocked specs in this suite.

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndLogin(page: Page) {
  const email = uniqueEmail("e2e_wizard");
  const password = "GoodPass1!";

  await page.goto("/auth/register");
  await page.getByPlaceholder("Jane Smith").fill("Wizard Test User");
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

const CONNECTION = {
  id: "conn-mock-1",
  broker_name: "tradier",
  display_name: "Tradier Sandbox (Mock)",
  account_id: "VA00000000",
  is_active: true,
  is_paper: true,
  permissions: { read: true, trade: true },
  last_sync_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

const PDT_STATUS = {
  connection_id: CONNECTION.id,
  display_name: CONNECTION.display_name,
  equity: 50000,
  pdt_applies: false,
  at_limit: false,
  day_trade_count: 0,
  day_trade_limit: 3,
  window_days: 5,
  remaining: 3,
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockAutomationPage(page: Page, opts: { existingConfig?: boolean; wizardResponse?: "success" | "rejected" } = {}) {
  await page.route("**/api/v1/broker/connections", (route) => {
    if (route.request().method() === "GET") return fulfillJson(route, [CONNECTION]);
    return route.continue();
  });
  await page.route("**/api/v1/signals/pdt-status", (route) => fulfillJson(route, [PDT_STATUS]));
  await page.route("**/api/v1/signals/options-automation/pending", (route) => fulfillJson(route, []));
  await page.route("**/api/v1/signals/options-automation", (route) => {
    if (route.request().method() === "GET") return fulfillJson(route, []);
    return route.continue();
  });
  await page.route("**/api/v1/signals/automation", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (!opts.existingConfig) return fulfillJson(route, []);
    return fulfillJson(route, [{
      id: "cfg-mock-1", broker_connection_id: CONNECTION.id, is_enabled: true,
      min_confidence: 0.6, max_position_size_usd: 1000, max_position_pct: 0.1,
      stop_loss_pct: 0.02, take_profit_pct: 0.04, max_daily_loss_usd: 500,
      max_open_positions: 5, cooldown_minutes: 60, max_trades_per_day: null, created_at: new Date().toISOString(),
    }]);
  });

  await page.route("**/api/v1/signals/automation/wizard", async (route) => {
    if (opts.wizardResponse === "rejected") {
      return fulfillJson(route, { detail: "Account equity must be positive to size an automation profile" }, 400);
    }
    const body = JSON.parse(route.request().postData() || "{}");
    return fulfillJson(
      route,
      {
        id: "cfg-mock-wizard-1", broker_connection_id: body.broker_connection_id, is_enabled: true,
        min_confidence: 0.75, max_position_size_usd: 4166.67, max_position_pct: 0.05,
        stop_loss_pct: 0.015, take_profit_pct: 0.03, max_daily_loss_usd: 1000,
        max_open_positions: 3, cooldown_minutes: 90, created_at: new Date().toISOString(),
      },
      201
    );
  });
}

test.describe("Risk Profile Wizard", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
  });

  test("positive: new user sees the wizard by default and can complete all 4 steps", async ({ page }) => {
    await mockAutomationPage(page, { wizardResponse: "success" });
    await page.goto("/automation");

    await expect(page.getByText("Risk Profile Wizard")).toBeVisible();
    await expect(page.getByText("Step 1 of 4")).toBeVisible();

    await page.getByRole("button", { name: /Conservative/ }).click();
    await expect(page.getByText("Step 2 of 4")).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Step 3 of 4")).toBeVisible();

    const postPromise = page.waitForRequest(
      (req) => req.url().includes("/signals/automation/wizard") && req.method() === "POST"
    );
    await page.getByText("My Watchlist", { exact: true }).click();
    await expect(page.getByText("Step 4 of 4")).toBeVisible();
    await expect(page.getByText("Max daily loss (hard stop)")).toBeVisible();

    await page.getByRole("button", { name: "Confirm & Go Live" }).click();
    const req = await postPromise;
    const sent = JSON.parse(req.postData() || "{}");
    expect(sent.risk_profile).toBe("conservative");
    expect(sent.universe).toBe("watchlist");

    await expect(page.getByText("Autopilot is live.")).toBeVisible();
  });

  test("positive: existing user sees their saved config first, with a link back to the wizard", async ({ page }) => {
    await mockAutomationPage(page, { existingConfig: true });
    await page.goto("/automation");

    await expect(page.getByText("Use guided setup instead")).toBeVisible();
    await expect(page.getByText("Risk Profile Wizard")).not.toBeVisible();

    await page.getByText("Use guided setup instead").click();
    await expect(page.getByText("Risk Profile Wizard")).toBeVisible();
  });

  test("positive: dollar capital mode shows the typed amount directly", async ({ page }) => {
    await mockAutomationPage(page);
    await page.goto("/automation");

    await page.getByRole("button", { name: /Balanced/ }).click();
    await page.getByRole("button", { name: "Dollar amount", exact: true }).click();
    await page.getByLabel("Dollar amount").fill("8000");

    await expect(page.getByText("≈ $8,000.00 of your $50,000.00 account equity")).toBeVisible();
  });

  test("positive: percent capital mode computes against real equity from pdt-status", async ({ page }) => {
    await mockAutomationPage(page);
    await page.goto("/automation");

    await page.getByRole("button", { name: /Aggressive/ }).click();
    await page.getByLabel("% of account equity").fill("20");

    // 20% of the mocked $50,000 equity
    await expect(page.getByText("≈ $10,000.00 of your $50,000.00 account equity")).toBeVisible();
  });

  test("negative: Continue is disabled until a capital value is entered", async ({ page }) => {
    await mockAutomationPage(page);
    await page.goto("/automation");

    await page.getByRole("button", { name: /Balanced/ }).click();
    await page.getByLabel("% of account equity").fill("0");
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  test("negative: backend rejection on confirm shows the real error, not a false success", async ({ page }) => {
    await mockAutomationPage(page, { wizardResponse: "rejected" });
    await page.goto("/automation");

    await page.getByRole("button", { name: /Balanced/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Day-Trade Scan Universe", { exact: true }).click();
    await page.getByRole("button", { name: "Confirm & Go Live" }).click();

    await expect(page.getByText("Account equity must be positive")).toBeVisible();
    await expect(page.getByText("Autopilot is live.")).not.toBeVisible();
  });
});
