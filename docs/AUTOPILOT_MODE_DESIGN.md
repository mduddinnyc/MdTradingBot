# Autopilot Mode — Design

*Prepared 2026-06-24 · builds on `docs/PLATFORM_ANALYSIS_AND_ROADMAP.md` and `docs/MULTI_AGENT_IMPROVEMENT_PLAN.md`*

## 1. Where we actually start from

This isn't a from-scratch build. Equity automation is already a real autopilot today: once `AutomationConfig.is_enabled=true`, the scheduler (`scheduler.py`) runs the signal engine on a timer and `execution.py` auto-places bracket orders with no human in the loop, gated by `min_confidence` (default 0.60), `max_position_pct` (10%), `stop_loss_pct`/`take_profit_pct` (2%/4%), `max_open_positions` (5), `cooldown_minutes` (60), an optional `max_daily_loss_usd`, and PDT compliance (all verified in `backend/app/models/automation.py` and `execution.py`).

What's missing is "minimal user effort." Today, getting to that autopilot state means manually filling 8 fields across a form most users don't have the context to set well. Options automation also exists end-to-end but deliberately stops one step short of autopilot — every staged order sits at `require_manual_approval=True` until a human clicks approve (`options_execution.py`). The plan below closes the effort gap on equities and proposes how options earns its way to true autopilot rather than just flipping the flag.

## 2. What to build

### 2.1 Risk Profile Wizard (frontend, replaces manual config form as the default path)

Three taps, in this order:

1. **Risk appetite** — Conservative / Balanced / Aggressive (Custom falls through to today's existing manual form, unchanged).
2. **Capital to allocate** — a dollar amount or % of account equity.
3. **Universe** — "my watchlist" or "let it scan the day-trade universe."

Confirm screen shows the resulting guardrail values in plain English before the first toggle is flipped — not buried in a settings page afterward.

### 2.2 Profile presets (backend — new, maps taps to existing fields)

No schema redesign needed; these are just named default sets for the columns that already exist on `automation_configs`. One material change: **`max_daily_loss_usd` becomes mandatory for every preset** (it's currently nullable and optional — flagged as a Critical gap in the prior analysis; an autopilot aimed at low-effort users should never ship without a hard floor).

| Field | Conservative | Balanced (≈ today's defaults) | Aggressive |
|---|---|---|---|
| `min_confidence` | 0.75 | 0.60 | 0.55 |
| `max_position_pct` | 5% | 10% | 15% |
| `stop_loss_pct` / `take_profit_pct` | 1.5% / 3% | 2% / 4% | 3% / 6% |
| `max_open_positions` | 3 | 5 | 8 |
| `cooldown_minutes` | 90 | 60 | 30 |
| `max_daily_loss_usd` | 2% of equity (mandatory) | 3% of equity (mandatory) | 5% of equity (mandatory) |

### 2.3 Portfolio Agent (new service — the part that's genuinely "acting on behalf of the user")

Today's automation is per-symbol: each signal is checked against the guardrails in isolation. A user running autopilot across 5–8 positions has no account-wide view. The Portfolio Agent is a thin layer that runs alongside the existing scheduler job and, before letting `execution.py` proceed, checks things no single-symbol check can: combined exposure across correlated positions (e.g., don't let 4 of 5 open slots all be semiconductor names), how close the account is to its daily loss cap right now, and whether the detected market regime (already computed in `signal_engine.py`) warrants throttling new entries account-wide. It can pause, shrink, or wave through — it never bypasses the hard per-trade guardrails in `execution.py`, it only sits in front of them.

This can ship in two stages: a deterministic ruleset first (correlation/exposure caps, regime-based throttle — ships fast, fully auditable), with an LLM-assisted daily portfolio review layered on later for qualitative judgment calls (e.g., "three positions are bunched the same direction going into a Fed day"). The LLM layer is advisory/throttling only — it can recommend pausing or shrinking, never override a hard cap.

## 3. Graduated autonomy, not a single toggle

"Minimal effort" and "your money, fully automated" are in tension — the way to resolve it isn't to soften the safeguards, it's to make trust earned and visible:

- **Level 0 — Paper only.** New profiles or new symbol universes always start here. No exceptions, including Aggressive.
- **Level 1 — Live equities, full autopilot.** What exists today, wrapped in the wizard above. This is where most users land.
- **Level 2 — Live options, full autopilot.** Unlocks `require_manual_approval=false` on `OptionsAutomationConfig`, but only after a defined clean track record at Level 1 (e.g., N trades or N days with no guardrail breach). The manual-approval gate doesn't disappear for everyone at once — it's earned per account.
- **Level 3 — Full portfolio agent, multi-asset.** The Portfolio Agent from Section 2.3 actively manages allocation across everything, not just gating it.

Each level requires its own explicit opt-in screen — never a silent upgrade.

## 4. Minimal-effort onboarding, end to end

Connect broker (exists) → Risk Profile Wizard, 3 taps (Section 2.1) → confirm screen shows plain-English guardrails → autopilot live at Level 1. Everything else — which symbols, when to trade, sizing, stop/take-profit, cooldown, PDT compliance — is the engine that already exists. No new user-facing complexity beyond the 3 taps and the level-up prompts in Section 3.

## 5. Safety non-negotiables

- `max_daily_loss_usd` mandatory on every preset (Section 2.2) — closes a currently-real gap, not a hypothetical one.
- Emergency-stop (`/signals/emergency-stop`, already shipped) must stay reachable in one tap from anywhere in the autopilot UI, plus a weekly email/push digest so a hands-off user still knows what happened.
- Portfolio Agent is additive — it can only pause or shrink, never bypass `execution.py`'s per-trade checks.
- Level 2 unlock criteria must be config, not code, so the bar can be tightened without a deploy.
- Confirm the broker's terms of service permit automated/bot trading for the account type before Level 2/3 go live on a given connection — this is an operational check, not legal advice.

## 6. How this gets built

This is itself a backlog candidate for the 5-agent loop in `docs/MULTI_AGENT_IMPROVEMENT_PLAN.md`: Requirements Agent turns Sections 2–3 into Given/When/Then items (e.g., *given a Conservative profile is selected, when the wizard confirms, then `automation_configs` is created with `max_daily_loss_usd` set and non-null*); Code Agent implements the wizard, presets, and Portfolio Agent ruleset; Testing Agent covers preset boundary conditions and the Level 1→2 unlock check; UI/UX Agent reviews the 3-tap flow and the plain-English confirm screen for clarity; End-User Agent runs the full "connect → 3 taps → autopilot live → kill switch still works" walkthrough on paper before it ever touches Level 1 in review.

## 7. Suggested build order

1. Mandatory `max_daily_loss_usd` on presets + the 3-tap wizard, Level 1 only (fastest path to "minimal effort," no new safety surface).
2. Portfolio Agent, deterministic ruleset (exposure/correlation/regime throttle).
3. Level 2 unlock mechanics (track-record check + config-driven threshold).
4. LLM-assisted advisory layer on top of the Portfolio Agent.
