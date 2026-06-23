# Contributing

## Branching

One feature = one branch off `main`, named `feature/<short-description>`
(e.g. `feature/auth-password-reset`). Keep branches small enough to review
in one sitting — if a change naturally splits into independent pieces
(backend logic, UI, tests), prefer separate branches over one large one.

```
git checkout main
git checkout -b feature/your-change
# ... commit work ...
git checkout main
git merge --ff-only feature/your-change
```

`--ff-only` keeps history linear and makes it obvious nothing was rebased
or rewritten — if it refuses, rebase the feature branch onto `main` first
rather than forcing a merge commit.

## Before merging

- **Backend**: `cd backend && docker compose exec backend pytest tests/ -v`
  must pass. New backend behavior gets a test in `backend/tests/<area>/`
  before merge, not after.
- **Frontend**: `cd frontend && npm run test:e2e` (Playwright, runs against
  the live `docker compose` stack — start it first) must pass. New pages or
  flows get a spec in `frontend/tests/<area>/`.
- **Type safety**: `npx tsc --noEmit` in `frontend/` should be clean.
- Manually exercise the change in the browser if it touches UI — automated
  tests catch regressions, they don't replace looking at the thing.

## Database changes

New tables/columns go through an Alembic migration in
`backend/app/migrations/versions/`, numbered sequentially after the latest
existing one. Mirror the model change and the migration in the same
commit — never let them drift apart.

## Commit messages

Explain *why*, not just *what* — the diff already shows what changed.
If a commit fixes a bug discovered while building something else, say so
and say how you found it; that context is what's actually hard to
reconstruct later.

## What "done" looks like

A feature is done when: it works against the real stack (not just unit
tests), it has test coverage at the layer where it can break, and the
migration (if any) has been run and verified, not just written.
