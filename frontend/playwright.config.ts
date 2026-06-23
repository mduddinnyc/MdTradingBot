import { defineConfig, devices } from "@playwright/test";

// Runs against the already-running docker-compose stack — no webServer
// block here, since `docker compose up` owns the frontend/backend
// lifecycle, same as how this whole project has been verified all along.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
