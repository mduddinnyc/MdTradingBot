import axios from "axios";

const BASE = process.env.NEXT_PUBLIC_API_URL + "/api/v1";

export const api = axios.create({ baseURL: BASE });

// ── Token storage (memory only — never localStorage) ───────────
let _accessToken: string | null = null;

export function setAccessToken(t: string | null) { _accessToken = t; }
export function getAccessToken() { return _accessToken; }

// Attach access token to every request
api.interceptors.request.use((config) => {
  if (_accessToken) config.headers.Authorization = `Bearer ${_accessToken}`;
  return config;
});

// Auth-bootstrap endpoints return their own meaningful 401s (e.g. wrong
// password) — these must never trigger the silent-refresh-and-redirect
// dance below, or a login failure gets swallowed by a hard page reload
// before React ever renders the error.
const AUTH_BOOTSTRAP_PATHS = ["/auth/login", "/auth/register", "/auth/refresh"];

// On 401, attempt refresh then retry once
api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original = err.config;
    const isAuthBootstrap = AUTH_BOOTSTRAP_PATHS.some((p) => original?.url?.includes(p));
    if (err.response?.status === 401 && !original._retry && !isAuthBootstrap) {
      original._retry = true;
      try {
        const rt = localStorage.getItem("rt");
        if (!rt) {
          clearSession();
          window.location.href = "/auth/login";
          return Promise.reject(err);
        }
        const { data } = await axios.post(`${BASE}/auth/refresh`, { refresh_token: rt });
        setAccessToken(data.access_token);
        localStorage.setItem("rt", data.refresh_token);
        original.headers.Authorization = `Bearer ${data.access_token}`;
        return api(original);
      } catch {
        clearSession();
        window.location.href = "/auth/login";
      }
    }
    return Promise.reject(err);
  }
);

export function clearSession() {
  setAccessToken(null);
  localStorage.removeItem("rt");
}

// ── Auth ───────────────────────────────────────────────────────
export const authApi = {
  register: (email: string, password: string, full_name?: string) =>
    api.post("/auth/register", { email, password, full_name }),

  login: async (email: string, password: string, totp_code?: string) => {
    const { data } = await api.post("/auth/login", { email, password, totp_code });
    if (data.access_token) {
      setAccessToken(data.access_token);
      localStorage.setItem("rt", data.refresh_token);
    }
    return data;
  },

  logout: async () => {
    const rt = localStorage.getItem("rt");
    if (rt) await api.post("/auth/logout", { refresh_token: rt }).catch(() => {});
    clearSession();
  },

  me: () => api.get("/auth/me").then((r) => r.data),

  forgotPassword: (email: string) =>
    api.post("/auth/password/forgot", { email }).then((r) => r.data),

  resetPassword: (token: string, new_password: string) =>
    api.post("/auth/password/reset", { token, new_password }).then((r) => r.data),

  oauthLogin: (provider: "google" | "apple") =>
    api.post(`/auth/oauth/${provider}`).then((r) => r.data),

  setup2fa: () => api.post("/auth/2fa/setup").then((r) => r.data),
  enable2fa: (code: string) => api.post("/auth/2fa/enable", { code }),
  disable2fa: (code: string) => api.post("/auth/2fa/disable", { code }),
};

// ── Broker ─────────────────────────────────────────────────────
export const brokerApi = {
  connect: (
    broker_name: string,
    api_key: string,
    api_secret: string,
    is_paper: boolean,
    display_name?: string,
  ) =>
    api
      .post("/broker/connect", { broker_name, api_key, api_secret, is_paper, display_name })
      .then((r) => r.data),

  list: () => api.get("/broker/connections").then((r) => r.data),

  disconnect: (id: string) => api.delete(`/broker/connections/${id}`),

  account: (id: string) => api.get(`/broker/connections/${id}/account`).then((r) => r.data),

  positions: (id: string) => api.get(`/broker/connections/${id}/positions`).then((r) => r.data),

  orders: (id: string) => api.get(`/broker/connections/${id}/orders`).then((r) => r.data),

  bars: (id: string, symbol: string, timeframe = "1Hour", limit = 100) =>
    api.get(`/broker/connections/${id}/bars/${symbol}`, { params: { timeframe, limit } }).then((r) => r.data),

  quote: (id: string, symbol: string) =>
    api.get(`/broker/connections/${id}/quote/${symbol}`).then((r) => r.data),

  options: (id: string, symbol: string) =>
    api.get(`/broker/connections/${id}/options/${symbol}`).then((r) => r.data),
};

// ── Signals ────────────────────────────────────────────────────
export const signalApi = {
  list: (limit = 50) => api.get("/signals/", { params: { limit } }).then((r) => r.data),

  refresh: (ticker: string) => api.post(`/signals/refresh/${ticker}`).then((r) => r.data),

  watchlist: () => api.get("/signals/watchlist").then((r) => r.data),

  addToWatchlist: (ticker: string) => api.post("/signals/watchlist", { ticker }),

  removeFromWatchlist: (ticker: string) => api.delete(`/signals/watchlist/${ticker}`),

  automationList: () => api.get("/signals/automation").then((r) => r.data),

  automationCreate: (body: object) => api.post("/signals/automation", body).then((r) => r.data),

  automationUpdate: (id: string, body: object) =>
    api.patch(`/signals/automation/${id}`, body).then((r) => r.data),

  orders: (limit = 100) => api.get("/signals/orders", { params: { limit } }).then((r) => r.data),

  emergencyStop: () => api.post("/signals/emergency-stop").then((r) => r.data),

  pdtStatus: () => api.get("/signals/pdt-status").then((r) => r.data),
};

// ── Analysis ───────────────────────────────────────────────────
export const analysisApi = {
  decisions: (limit = 50, symbol?: string) =>
    api.get("/analysis/decisions", { params: { limit, symbol } }).then((r) => r.data),

  decision: (id: string) =>
    api.get(`/analysis/decisions/${id}`).then((r) => r.data),

  stats: () => api.get("/analysis/stats").then((r) => r.data),

  performance: (symbol?: string) =>
    api.get("/analysis/performance", { params: { symbol } }).then((r) => r.data),
};
