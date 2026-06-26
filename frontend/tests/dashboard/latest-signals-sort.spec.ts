import { test, expect, Page, Route } from "@playwright/test";

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndLogin(page: Page) {
  const email = uniqueEmail("e2e_dash_sort");
  const password = "GoodPass1!";

  await page.goto("/auth/register");
  await page.getByPlaceholder("Jane Smith").fill("Dashboard Sort Test User");
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

const SIGNALS = [
  { id: "1", symbol: "ORCL", signal_type: "SELL", confidence: 0.477, entry_price: 151.94, target_price: 149.34, pattern_detected: null },
  { id: "2", symbol: "TSLA", signal_type: "SELL", confidence: 0.251, entry_price: 387.0, target_price: 384.02, pattern_detected: "Bullish Engulfing" },
  { id: "3", symbol: "GOOGL", signal_type: "HOLD", confidence: 0.096, entry_price: 344.28, target_price: null, pattern_detected: "Hammer" },
  { id: "4", symbol: "AAPL", signal_type: "SELL", confidence: 0.272, entry_price: 278.13, target_price: 269.67, pattern_detected: null },
];

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockDashboard(page: Page) {
  await page.route("**/api/v1/broker/connections", (route) => fulfillJson(route, []));
  await page.route("**/api/v1/signals/?*", (route) => fulfillJson(route, SIGNALS));
  await page.route("**/api/v1/signals/", (route) => fulfillJson(route, SIGNALS));
}

test.describe("Dashboard Latest Signals sorting", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await mockDashboard(page);
    await page.goto("/dashboard");
    await expect(page.getByText("Latest Signals")).toBeVisible();
  });

  test("positive: sorting by Confidence ascending then descending reorders rows", async ({ page }) => {
    const firstCellText = () => page.locator("tbody tr").first().locator("td").first().innerText();

    // first click = desc (toggleSort's default): highest confidence (ORCL 47.7%) first
    await page.getByRole("button", { name: "Confidence" }).click();
    await expect.poll(firstCellText).toBe("ORCL");

    // second click = asc: lowest confidence (GOOGL 9.6%) first
    await page.getByRole("button", { name: "Confidence" }).click();
    await expect.poll(firstCellText).toBe("GOOGL");
  });

  test("positive: sorting by Symbol alphabetizes rows", async ({ page }) => {
    await page.getByRole("button", { name: "Symbol" }).click(); // first click = desc
    await expect(page.locator("tbody tr").first()).toContainText("TSLA");

    await page.getByRole("button", { name: "Symbol" }).click(); // second click = asc
    await expect(page.locator("tbody tr").first()).toContainText("AAPL");
  });

  test("positive: sorting by Entry orders by price", async ({ page }) => {
    await page.getByRole("button", { name: "Entry" }).click(); // desc: highest price first (TSLA $387)
    await expect(page.locator("tbody tr").first()).toContainText("TSLA");

    await page.getByRole("button", { name: "Entry" }).click(); // asc: lowest price first (ORCL $151.94)
    await expect(page.locator("tbody tr").first()).toContainText("ORCL");
  });

  test("positive: sorting by Target treats the null (HOLD/GOOGL) row consistently, not crashing", async ({ page }) => {
    await page.getByRole("button", { name: "Target" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(4);
  });

  test("negative: clicking a sort header never throws or empties the table", async ({ page }) => {
    for (const label of ["Symbol", "Signal", "Confidence", "Entry", "Target", "Pattern"]) {
      await page.getByRole("button", { name: label }).click();
      await expect(page.locator("tbody tr")).toHaveCount(4);
    }
  });
});
