import { test, expect, Page, Route } from "@playwright/test";

// Same mocking discipline as order-ticket.spec.ts — staging an option hits
// a real broker for a live quote, so every broker/signal call is mocked
// here; only auth runs against the real backend.

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndLogin(page: Page) {
  const email = uniqueEmail("e2e_opt_ticket");
  const password = "GoodPass1!";

  await page.goto("/auth/register");
  await page.getByPlaceholder("Jane Smith").fill("Options Ticket Test User");
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

const QUOTE = {
  symbol: "AAPL", description: "Apple Inc", ask_price: 200.1, bid_price: 199.9,
  ask_size: 5, bid_size: 5, last: 200, change: 1.5, change_percentage: 0.75,
  open: 199, high: 201, low: 198, prevclose: 198.5, volume: 1_000_000,
  average_volume: 900_000, week_52_high: 220, week_52_low: 150,
  timestamp: new Date().toISOString(),
};

const EXPIRATIONS = ["2026-07-02", "2026-07-09"];

const CHAIN = {
  symbol: "AAPL",
  expiration: "2026-07-02",
  options: [
    { symbol: "AAPL260702C00200000", option_type: "call", strike: 200, bid: 5.5, ask: 5.7 },
    { symbol: "AAPL260702C00210000", option_type: "call", strike: 210, bid: 2.1, ask: 2.3 },
    { symbol: "AAPL260702P00200000", option_type: "put", strike: 200, bid: 4.5, ask: 4.7 },
  ],
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockTradingData(page: Page, opts: { stageResponse?: "success" | "rejected" } = {}) {
  await page.route("**/api/v1/broker/connections", (route) => {
    if (route.request().method() === "GET") return fulfillJson(route, [CONNECTION]);
    return route.continue();
  });
  await page.route("**/api/v1/signals/watchlist", (route) => {
    if (route.request().method() === "GET") {
      return fulfillJson(route, [{ ticker: "AAPL", name: "Apple Inc", added_at: new Date().toISOString() }]);
    }
    return route.continue();
  });
  await page.route("**/api/v1/broker/connections/*/quote/*", (route) => fulfillJson(route, QUOTE));
  await page.route("**/api/v1/broker/connections/*/bars/*", (route) => fulfillJson(route, []));
  await page.route("**/api/v1/broker/connections/*/options/*/expirations", (route) => fulfillJson(route, EXPIRATIONS));
  await page.route("**/api/v1/broker/connections/*/options/*", (route) => fulfillJson(route, CHAIN));

  await page.route("**/api/v1/signals/options-automation/manual", async (route) => {
    if (opts.stageResponse === "rejected") {
      return fulfillJson(route, { detail: "This would cost ~$570.00; only $200.00 of your options budget remains" }, 400);
    }
    const body = JSON.parse(route.request().postData() || "{}");
    return fulfillJson(
      route,
      {
        id: "opt-order-mock-1",
        ticker: body.ticker,
        option_symbol: body.option_symbol,
        option_right: body.option_right,
        strike_price: body.strike_price,
        expiration_date: body.expiration_date,
        quantity: body.quantity,
        premium_paid: 5.7,
        status: "pending_approval",
        created_at: new Date().toISOString(),
      },
      201
    );
  });
}

async function openOptionsTicket(page: Page) {
  await page.goto("/watchlist");
  await page.getByText("AAPL", { exact: true }).click();
  await page.getByRole("button", { name: "Options", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AAPL options order ticket" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Options order ticket", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
  });

  test("positive: buy a call, review, and stage for approval", async ({ page }) => {
    await mockTradingData(page, { stageResponse: "success" });
    const dialog = await openOptionsTicket(page);

    await dialog.getByRole("button", { name: /\$200\.00/ }).click();

    const postPromise = page.waitForRequest(
      (req) => req.url().includes("/signals/options-automation/manual") && req.method() === "POST"
    );
    await dialog.getByRole("button", { name: "Review" }).click();
    await expect(dialog.getByText("BUY TO OPEN")).toBeVisible();
    await dialog.getByRole("button", { name: "Stage for Approval" }).click();

    const req = await postPromise;
    const sent = JSON.parse(req.postData() || "{}");
    expect(sent.side).toBe("buy");
    expect(sent.option_right).toBe("call");
    expect(sent.option_symbol).toBe("AAPL260702C00200000");
    expect(sent.strike_price).toBe(200);

    await expect(dialog.getByText("Staged for Approval")).toBeVisible();
  });

  test("positive: switching to Put filters the strike list to puts only", async ({ page }) => {
    await mockTradingData(page);
    const dialog = await openOptionsTicket(page);

    await dialog.getByRole("button", { name: "Put", exact: true }).click();
    await expect(dialog.getByRole("button", { name: /\$200\.00/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /\$210\.00/ })).toHaveCount(0);
  });

  test("positive: current price shown at the top and inline in the strike list", async ({ page }) => {
    await mockTradingData(page);
    const dialog = await openOptionsTicket(page);

    await expect(dialog.getByText(/Current Price\$200\.00/)).toBeVisible();
    await expect(dialog.getByText("AAPL price: $200.00")).toBeVisible();
  });

  test("positive: Sell side reviews as SELL TO CLOSE", async ({ page }) => {
    await mockTradingData(page);
    const dialog = await openOptionsTicket(page);

    await dialog.getByRole("button", { name: "Sell", exact: true }).click();
    await dialog.getByRole("button", { name: /\$200\.00/ }).click();
    await dialog.getByRole("button", { name: "Review" }).click();

    await expect(dialog.getByText("SELL TO CLOSE")).toBeVisible();
  });

  test("negative: Review is disabled until a strike is selected", async ({ page }) => {
    await mockTradingData(page);
    const dialog = await openOptionsTicket(page);

    await expect(dialog.getByRole("button", { name: "Review" })).toBeDisabled();
  });

  test("negative: broker/budget rejection shows the real error, not a false success", async ({ page }) => {
    await mockTradingData(page, { stageResponse: "rejected" });
    const dialog = await openOptionsTicket(page);

    await dialog.getByRole("button", { name: /\$200\.00/ }).click();
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Stage for Approval" }).click();

    await expect(dialog.getByText(/only \$200\.00 of your options budget remains/)).toBeVisible();
    await expect(dialog.getByText("Staged for Approval")).not.toBeVisible();
  });
});
