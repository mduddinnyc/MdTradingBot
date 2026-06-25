# Multi-Agent Product Improvement Plan

*Prepared 2026-06-24 · builds on `docs/PLATFORM_ANALYSIS_AND_ROADMAP.md`*

## 1. Goal

Turn the gap analysis into a running system: five agents that continuously find what to build, build it, and prove it works — automated checks plus human-judgment-like review — before anything reaches `main`. Repo state checked before writing this: `.claude/` currently holds only `settings.local.json` (Bash/MCP permissions) and a Playwright `launch.json` debug config — no subagents, no commands, no CI workflow exist yet. This is a fresh build, not a retrofit.

## 2. The five agents

| Agent | Job | Primary inputs | Primary output | Routes failures to |
|---|---|---|---|---|
| **Requirements Agent** | Decide what to build next | Gap analysis, `audit_logs`/`analysis` usage stats, competitor scans, feedback from the other 4 agents | `docs/BACKLOG.md` items with Given/When/Then acceptance criteria | — (it's the destination) |
| **Code Agent** | Implement against the spec | Backlog item, `CONTRIBUTING.md` conventions, existing code patterns (`BrokerAdapter` Protocol, migration-per-model-change rule) | Feature branch + PR | Requirements Agent (if spec was ambiguous/infeasible) |
| **Testing Agent** | Prove it works mechanically | The PR diff, acceptance criteria | pytest/Playwright results, pass/fail | Requirements Agent (regression ticket) |
| **UI/UX Agent** | Prove it's usable and consistent | Changed frontend routes, Playwright screenshots, existing component patterns | Heuristic review (Nielsen's 10, WCAG AA contrast, mobile breakpoints, copy clarity on risk actions) | Requirements Agent (usability ticket) |
| **End-User Agent** | Prove a real trader would trust it | The deployed staging build | A persona's qualitative walkthrough report — friction, confusion, broken trust signals | Requirements Agent (UX/trust ticket) |

Testing and UI/UX run in parallel once Code Agent opens a PR; both must pass before End-User Agent does a final walkthrough on staging; only then does the merge gate open. Any failure anywhere writes a new backlog item with repro steps — the loop is genuinely closed, not just sequential.

## 3. Why this order, and why it's safe

Testing Agent answers "does it work." UI/UX Agent answers "is it usable and consistent with the rest of the app." End-User Agent answers "would I actually trust this with my money" — this is the "test it like a user" piece you asked for, and it's deliberately the *last* gate, not the first, because it's the most expensive check and the other two should catch most defects first. End-User Agent must only ever run against paper-trading staging credentials — never live broker keys — and Code Agent should never have write access to encryption keys or production secrets.

## 4. Step-by-step build plan

**Step 0 — Prerequisites (do this before any agent goes live).** The agents enforce a bar that doesn't exist yet. Stand up `.github/workflows/ci.yml` running `pytest tests/ -v`, `npm run test:e2e`, `npx tsc --noEmit` as required checks; fix the TOTP XOR-encryption gap; add the first round of pytest coverage for the signal engine and execution guardrails. This is Phase 1 from the prior roadmap — without it, "Testing Agent passed" means nothing.

**Step 1 — Requirements Agent.** Build as a Claude Code subagent at `.claude/agents/requirements-analyst.md`, scoped read-only against the codebase plus the `analysis`/`audit_logs` tables. Run it weekly via a scheduled task. Its first job: seed `docs/BACKLOG.md` with the gap list already in `PLATFORM_ANALYSIS_AND_ROADMAP.md` (see Section 6 below for the first 4 items in the target format).

**Step 2 — Code Agent.** Subagent at `.claude/agents/code-implementer.md`, invoked per backlog item. System prompt should hard-require: read `CONTRIBUTING.md` first, mirror any schema change with an Alembic migration in the same commit, never bypass the options manual-approval gate, open a PR rather than pushing to `main`.

**Step 3 — Testing Agent.** Pairs with the Step 0 CI pipeline. Subagent at `.claude/agents/qa-tester.md` writes new test cases from each backlog item's acceptance criteria (test-first, alongside or just ahead of Code Agent's implementation) — specifically targeting guardrail edge cases (confidence threshold boundaries, PDT limits, daily loss cap, kill switch) and broker-adapter contract tests, which today have zero coverage.

**Step 4 — UI/UX Agent.** Subagent at `.claude/agents/ux-reviewer.md`, triggered on any PR touching `frontend/`. Takes Playwright screenshots of changed routes, checks against a fixed checklist (contrast, keyboard nav, mobile breakpoint, consistency with existing components like `SignalBadge`/`CandleChart`, and — given this is a trading app — extra scrutiny on copy and confirmation flows around irreversible actions like order approval and emergency-stop).

**Step 5 — End-User Agent.** Subagent at `.claude/agents/end-user-simulator.md`, driving the staging deploy through Chrome/computer-use style browser automation as a named trader persona: register → enable 2FA → connect a **paper** broker → add a watchlist symbol → wait for or force a signal → configure automation guardrails → deliberately submit a bad config and confirm it's rejected → approve a staged options order → trigger emergency-stop → confirm an audit-log entry exists for every step. Output is prose feedback, not just pass/fail — that's what makes it catch what the other agents can't.

**Step 6 — Wire the merge gate.** Branch protection on `main` requires: CI green (Step 0) → Testing Agent + UI/UX Agent both green → End-User Agent walkthrough on staging logged with no blocking friction → only then can Code Agent's PR merge. Any red anywhere auto-files a tagged backlog item back into Requirements Agent's queue with the failure context attached.

**Step 7 — Operate and tune.** Weekly: Requirements Agent re-prioritizes using whatever Testing/UI-UX/End-User agents flagged that week plus the original competitive gaps. Monthly: a human spot-checks a sample of each agent's decisions and tightens its prompt/checklist — these are review aids, not an unsupervised pipeline.

## 5. Mapping onto the existing 3-phase roadmap

- **Phase 1 (Foundation)** = Step 0, plus Requirements/Code/Testing agents (Steps 1–3) running on the foundation backlog itself (CI, TOTP fix, test coverage).
- **Phase 2 (Parity)** = full 5-agent loop, including UI/UX and End-User agents, running on the portfolio risk engine and live-options work.
- **Phase 3 (Differentiation)** = same loop running on the strategy marketplace and mobile work, where UI/UX and End-User agents matter most.

## 6. First 4 backlog items (seed `docs/BACKLOG.md` with these)

1. **CI pipeline** — *Given* a PR is opened, *when* pytest/`tsc --noEmit`/Playwright run, *then* the PR is blocked from merging if any check fails.
2. **TOTP encryption fix** — *Given* a TOTP secret is generated, *when* it's persisted, *then* it must be Fernet/AES-256-GCM encrypted, not XOR-encoded.
3. **Portfolio-level risk engine** — *Given* a user has multiple open automated positions, *when* aggregate account drawdown exceeds a configured limit, *then* no new automated orders are placed and existing automation configs are auto-paused with an audit-log entry.
4. **Signal-engine-based backtesting** — *Given* a backtest is requested, *when* it runs, *then* it must invoke the live `signal_engine` against historical candles (not the EMA9/21 proxy) and report slippage-adjusted results.

## 7. Risks

- **Agents rubber-stamping each other** — mitigate with separate prompts/personas per agent and independent acceptance criteria; don't let one model session play all five roles in the same context.
- **End-User Agent touching real money** — hard-restrict it to paper-trading staging credentials; never give it live broker keys.
- **Code Agent scope creep** — no write access to encryption keys, production secrets, or the options manual-approval gate itself.
- **False sense of coverage** — Testing Agent passing doesn't mean the product is good; UI/UX and End-User agents exist specifically because automated checks miss usability and trust issues.
