# End-to-end tests (Playwright)

E2E flows run against the **live app** (production by default). They cover the
pre-login landing page (anonymous) and the authenticated officer flows
(Library, ruling-alerts, a save round-trip).

## Run

```bash
# Point at an environment (defaults to production)
export E2E_BASE_URL=https://bharattax.wenvia.global

# Credentials for a test account — never committed
export E2E_OFFICER_EMAIL=officer1@bharathtax.com
export E2E_OFFICER_PASSWORD=********

npm run e2e
```

The `setup` project logs the officer in **once** (one seat) and saves the
session to `e2e/.auth/officer.json` (git-ignored); the officer specs reuse it.
The save round-trip cleans up the item it creates, so the account is left clean.

## Structure

- `auth.setup.ts` — one real login, persists storage state.
- `landing.spec.ts` — anonymous: landing copy + login form + bad-cred rejection.
- `officer-flows.spec.ts` — authenticated: app shell, Library page, ruling-alerts
  payload shape, and a seed→see→delete round-trip.
