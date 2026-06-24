import { test, expect, Page, Route } from "@playwright/test";

// Order placement hits a real broker, so unlike the auth specs this suite
// mocks every broker/signal data call — only auth runs against the real
// backend (cheap, fast, already proven reliable by the auth specs).

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndLogin(page: Page) {
  const email = uniqueEmail("e2e_order_ticket");
  const password = "GoodPass1!";

  await page.goto("/auth/register");
  await page.getByPlaceholder("Jane Smith").fill("Order Ticket Test User");
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
  symbol: "AAPL",
  description: "Apple Inc",
  ask_price: 200.1,
  bid_price: 199.9,
  ask_size: 5,
  bid_size: 5,
  last: 200,
  change: 1.5,
  change_percentage: 0.75,
  open: 199,
  high: 201,
  low: 198,
  prevclose: 198.5,
  volume: 1_000_000,
  average_volume: 900_000,
  week_52_high: 220,
  week_52_low: 150,
  timestamp: new Date().toISOString(),
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Wires every data dependency the Watchlist page + OrderTicket need, with mock data only — no real broker call ever fires. */
async function mockTradingData(page: Page, opts: { orderResponse?: "success" | "rejected" } = {}) {
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

  await page.route("**/api/v1/signals/orders/manual", async (route) => {
    if (opts.orderResponse === "rejected") {
      return fulfillJson(
        route,
        { detail: "Tradier: Invalid parameter, quantity: decimal places are not allowed." },
        400
      );
    }
    const body = JSON.parse(route.request().postData() || "{}");
    return fulfillJson(
      route,
      {
        id: "order-mock-1",
        ticker: body.ticker,
        side: body.side,
        quantity: body.quantity,
        status: "filled",
        is_automated: false,
        rejection_reason: null,
        asset_type: "equity",
        option_right: null,
        avg_fill_price: QUOTE.last,
        stop_price: body.stop_loss_price,
        take_profit_price: body.take_profit_price,
        submitted_at: new Date().toISOString(),
        filled_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        exit_price: null,
        closed_at: null,
        pnl_usd: null,
        pnl_pct: null,
      },
      201
    );
  });
}

async function openTicket(page: Page) {
  await page.goto("/watchlist");
  await page.getByText("AAPL", { exact: true }).click();
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AAPL order ticket" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Order ticket", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
  });

  test("positive: market buy order sends and shows confirmation", async ({ page }) => {
    await mockTradingData(page, { orderResponse: "success" });
    const dialog = await openTicket(page);

    const postPromise = page.waitForRequest((req) => req.url().includes("/signals/orders/manual") && req.method() === "POST");

    await dialog.getByRole("button", { name: "Review Order" }).click();
    await expect(dialog.getByText("Side")).toBeVisible();
    await dialog.getByRole("button", { name: "Send Buy Order" }).click();

    const req = await postPromise;
    const sent = JSON.parse(req.postData() || "{}");
    expect(sent.side).toBe("buy");
    expect(sent.order_type).toBe("market");
    expect(sent.ticker).toBe("AAPL");

    await expect(dialog.getByText("Order Placed")).toBeVisible();
  });

  test("positive: sell side toggles and sends side=sell", async ({ page }) => {
    await mockTradingData(page, { orderResponse: "success" });
    const dialog = await openTicket(page);

    await dialog.getByRole("button", { name: "Sell", exact: true }).click();
    const postPromise = page.waitForRequest((req) => req.url().includes("/signals/orders/manual") && req.method() === "POST");

    await dialog.getByRole("button", { name: "Review Order" }).click();
    await dialog.getByRole("button", { name: "Send Sell Order" }).click();

    const req = await postPromise;
    expect(JSON.parse(req.postData() || "{}").side).toBe("sell");
  });

  test("positive: limit order sends the typed limit price", async ({ page }) => {
    await mockTradingData(page, { orderResponse: "success" });
    const dialog = await openTicket(page);

    await dialog.getByRole("button", { name: "Limit", exact: true }).click();
    await dialog.getByLabel("Limit Price").fill("195.50");

    const postPromise = page.waitForRequest((req) => req.url().includes("/signals/orders/manual") && req.method() === "POST");
    await dialog.getByRole("button", { name: "Review Order" }).click();
    await expect(dialog.getByText("limit @ $195.50")).toBeVisible();
    await dialog.getByRole("button", { name: "Send Buy Order" }).click();

    const req = await postPromise;
    expect(JSON.parse(req.postData() || "{}").limit_price).toBe(195.5);
  });

  test("positive: stop-loss percent computes the correct preview price for a buy", async ({ page }) => {
    await mockTradingData(page);
    const dialog = await openTicket(page);

    await dialog.getByLabel("Stop-Loss").check();
    // default 10% — buy stop is below the $200 mock quote: 200 * 0.9 = 180
    await expect(dialog.getByText("Stop @ $180.00")).toBeVisible();
  });

  test("positive: take-profit percent computes the correct preview price for a buy", async ({ page }) => {
    await mockTradingData(page);
    const dialog = await openTicket(page);

    await dialog.getByLabel("Take-Profit").check();
    // buy target is above the $200 mock quote: 200 * 1.1 = 220
    await expect(dialog.getByText("Target @ $220.00")).toBeVisible();
  });

  test("edge: sell-side brackets mirror buy-side (stop above, target below)", async ({ page }) => {
    await mockTradingData(page);
    const dialog = await openTicket(page);

    await dialog.getByRole("button", { name: "Sell", exact: true }).click();
    await dialog.getByLabel("Stop-Loss").check();
    await dialog.getByLabel("Take-Profit").check();

    await expect(dialog.getByText("Stop @ $220.00")).toBeVisible();
    await expect(dialog.getByText("Target @ $180.00")).toBeVisible();
  });

  test("negative: limit order with no price blocks Review Order", async ({ page }) => {
    await mockTradingData(page);
    const dialog = await openTicket(page);

    await dialog.getByRole("button", { name: "Limit", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Review Order" })).toBeDisabled();
    await expect(dialog.getByText("Enter a limit price to continue.")).toBeVisible();
  });

  test("negative: stop-loss on the wrong side of entry blocks Review Order", async ({ page }) => {
    await mockTradingData(page);
    const dialog = await openTicket(page);

    // $ mode lets the price be entered directly — set it above the $200
    // mock quote on a buy, which is the wrong side for a protective stop.
    await dialog.getByLabel("Stop-Loss").check();
    await dialog.getByRole("button", { name: "$", exact: true }).first().click();
    await dialog.locator('input[type="number"]').nth(1).fill("210");

    await expect(dialog.getByRole("button", { name: "Review Order" })).toBeDisabled();
    await expect(dialog.getByText("Stop-loss must be below the entry price.")).toBeVisible();
  });

  test("negative: zero quantity blocks Review Order", async ({ page }) => {
    await mockTradingData(page);
    const dialog = await openTicket(page);

    await dialog.getByLabel("Quantity").fill("0");
    await expect(dialog.getByRole("button", { name: "Review Order" })).toBeDisabled();
    await expect(dialog.getByText("Enter a quantity greater than 0.")).toBeVisible();
  });

  test("negative: broker rejection shows the real error and does not claim success", async ({ page }) => {
    await mockTradingData(page, { orderResponse: "rejected" });
    const dialog = await openTicket(page);

    await dialog.getByRole("button", { name: "Review Order" }).click();
    await dialog.getByRole("button", { name: "Send Buy Order" }).click();

    await expect(dialog.getByText(/decimal places are not allowed/)).toBeVisible();
    await expect(dialog.getByText("Order Placed")).not.toBeVisible();
  });
});
