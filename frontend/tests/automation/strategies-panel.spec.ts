import { test, expect, Page, Route } from "@playwright/test";

// Strategies panel saves real UserStrategyConfig rows, so every broker/
// signal call is mocked here — only auth runs against the real backend.

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndLogin(page: Page) {
  const email = uniqueEmail("e2e_strategies");
  const password = "GoodPass1!";

  await page.goto("/auth/register");
  await page.getByPlaceholder("Jane Smith").fill("Strategies Test User");
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
  connection_id: CONNECTION.id, display_name: CONNECTION.display_name, equity: 50000,
  pdt_applies: false, at_limit: false, day_trade_count: 0, day_trade_limit: 3, window_days: 5, remaining: 3,
};

function strategy(overrides: Record<string, unknown>) {
  return {
    id: "strat-balanced", key: "balanced", name: "Balanced",
    description: "Today's default weighting.",
    w_trend: 0.4, w_momentum: 0.35, w_pattern: 0.25, allowed_regimes: null, min_volume_ratio: null,
    is_enabled: false, mode: "manual", allocated_capital_usd: 1000,
    total_trades: 0, wins: 0, win_rate: null, total_pnl_usd: null,
    ...overrides,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockAutomationPage(page: Page, opts: { strategies?: any[] } = {}) {
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
    if (route.request().method() === "GET") {
      return fulfillJson(route, [{
        id: "cfg-mock-1", broker_connection_id: CONNECTION.id, is_enabled: true,
        min_confidence: 0.6, max_position_size_usd: 1000, max_position_pct: 0.1,
        stop_loss_pct: 0.02, take_profit_pct: 0.04, max_daily_loss_usd: 500,
        max_open_positions: 5, cooldown_minutes: 60, created_at: new Date().toISOString(),
      }]);
    }
    return route.continue();
  });

  const strategies = opts.strategies ?? [
    strategy({}),
    strategy({ id: "strat-trend", key: "trend_following", name: "Trend Following", allowed_regimes: ["trending_bull", "trending_bear"] }),
    strategy({ id: "strat-mr", key: "mean_reversion", name: "Mean Reversion", allowed_regimes: ["sideways"] }),
    strategy({ id: "strat-mom", key: "momentum_breakout", name: "Momentum Breakout", min_volume_ratio: 1.5 }),
  ];
  await page.route("**/api/v1/signals/strategies", (route) => {
    if (route.request().method() === "GET") return fulfillJson(route, strategies);
    return route.continue();
  });
  await page.route("**/api/v1/signals/strategies/performance**", (route) => fulfillJson(route, []));
}

test.describe("Strategies panel", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
  });

  test("positive: all 4 strategies render with name, description, and not-enough-trades state", async ({ page }) => {
    await mockAutomationPage(page);
    await page.goto("/automation");

    await expect(page.getByText("Trend Following")).toBeVisible();
    await expect(page.getByText("Mean Reversion")).toBeVisible();
    await expect(page.getByText("Momentum Breakout")).toBeVisible();
    await expect(page.getByText("Balanced")).toBeVisible();
    await expect(page.getByText("Not enough trades yet (0/3)").first()).toBeVisible();
  });

  test("positive: enabling a strategy sends is_enabled=true", async ({ page }) => {
    await mockAutomationPage(page);
    await page.goto("/automation");

    const putPromise = page.waitForRequest(
      (req) => req.url().includes("/signals/strategies/strat-trend/config") && req.method() === "PUT"
    );
    await page.route("**/api/v1/signals/strategies/strat-trend/config", (route) =>
      fulfillJson(route, strategy({ id: "strat-trend", key: "trend_following", name: "Trend Following", is_enabled: true }))
    );

    const card = page.locator("div.rounded-lg", { hasText: "Trend Following" }).first();
    await card.getByRole("checkbox").click();

    const req = await putPromise;
    const sent = JSON.parse(req.postData() || "{}");
    expect(sent.is_enabled).toBe(true);
  });

  test("positive: switching to Autopilot mode sends mode=auto", async ({ page }) => {
    await mockAutomationPage(page);
    await page.goto("/automation");

    const putPromise = page.waitForRequest(
      (req) => req.url().includes("/signals/strategies/strat-balanced/config") && req.method() === "PUT"
    );
    await page.route("**/api/v1/signals/strategies/strat-balanced/config", (route) =>
      fulfillJson(route, strategy({ mode: "auto" }))
    );

    const card = page.locator("div.rounded-lg", { hasText: "Balanced" }).first();
    await card.getByRole("button", { name: "Autopilot" }).click();

    const req = await putPromise;
    expect(JSON.parse(req.postData() || "{}").mode).toBe("auto");
  });

  test("positive: editing capital and blurring sends the new amount", async ({ page }) => {
    await mockAutomationPage(page);
    await page.goto("/automation");

    const putPromise = page.waitForRequest(
      (req) => req.url().includes("/signals/strategies/strat-balanced/config") && req.method() === "PUT"
    );
    await page.route("**/api/v1/signals/strategies/strat-balanced/config", (route) =>
      fulfillJson(route, strategy({ allocated_capital_usd: 2500 }))
    );

    const card = page.locator("div.rounded-lg", { hasText: "Balanced" }).first();
    const capitalInput = card.locator('input[type="number"]');
    await capitalInput.fill("2500");
    await capitalInput.blur();

    const req = await putPromise;
    expect(JSON.parse(req.postData() || "{}").allocated_capital_usd).toBe(2500);
  });

  test("positive: a strategy with real trade history shows its win rate", async ({ page }) => {
    await mockAutomationPage(page, {
      strategies: [strategy({ total_trades: 5, wins: 4, win_rate: 0.8, total_pnl_usd: 312.5 })],
    });
    await page.goto("/automation");

    await expect(page.getByText("80.0%", { exact: false })).toBeVisible();
    await expect(page.getByText("+$312.50")).toBeVisible();
  });

  test("positive: performance comparison table shows real per-strategy results", async ({ page }) => {
    await mockAutomationPage(page);
    await page.route("**/api/v1/signals/strategies/performance**", (route) =>
      fulfillJson(route, [
        { strategy_id: "strat-trend", strategy_key: "trend_following", strategy_name: "Trend Following", trades: 6, wins: 4, win_rate: 0.667, total_pnl_usd: 145.2, avg_pnl_pct: 0.021 },
        { strategy_id: "strat-mr", strategy_key: "mean_reversion", strategy_name: "Mean Reversion", trades: 3, wins: 1, win_rate: 0.333, total_pnl_usd: -42.1, avg_pnl_pct: -0.01 },
      ])
    );
    await page.goto("/automation");

    await expect(page.getByText("Strategy Performance")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Trend Following" })).toBeVisible();
    await expect(page.getByText("+$145.20")).toBeVisible();
    await expect(page.getByText("$-42.10")).toBeVisible();
  });

  test("negative: empty performance table shows a clear empty state, not a blank table", async ({ page }) => {
    await mockAutomationPage(page);
    await page.goto("/automation");

    await expect(page.getByText("No closed trades from any strategy in this period yet.")).toBeVisible();
  });
});
