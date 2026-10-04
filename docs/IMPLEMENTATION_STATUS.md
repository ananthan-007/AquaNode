# Implementation Status

Last updated: post-typecheck-fix pass. `npm install` was run successfully by
the user; `npm run typecheck` reported 19 errors across 4 files, all fixed
(see "Typecheck fix log" below). Not yet re-verified — awaiting the user's
next `npm run typecheck` run.

## Status categories used below
- **IMPLEMENTED** — code exists, has not been run/executed.
- **VALIDATED** — actually executed and confirmed working (none yet).
- **BLOCKED** — cannot currently be tested in this environment.
- **DRAFT** — depends on a decision not yet approved (hardware/team).
- **NOT IMPLEMENTED** — genuinely missing, intentionally deferred.

## Environment note (read first)
This build environment has no internet access: `npm install` was never run
(no `node_modules`, no lockfile), `next dev`/`next build`/`tsc` were never
run, and no live Supabase project was connected. Nothing below is marked
VALIDATED. You must run the commands in the "Local validation" section and
report results before anything moves from IMPLEMENTED to VALIDATED.

## Audit checklist (28 areas)

1. **Next.js/App Router structure** — IMPLEMENTED. App Router used
   throughout (`app/(auth)`, `app/(dashboard)`, `app/api`). No TanStack Start
   or other framework substitution occurred — confirmed by inspection.
2. **TypeScript** — IMPLEMENTED. `tsconfig.json` strict mode on. Not yet
   type-checked (`tsc --noEmit` never run).
3. **Tailwind** — IMPLEMENTED. Config + `globals.css` directives present.
   Not yet built/verified to actually compile.
4. **Authentication** — IMPLEMENTED. Supabase Auth email/password via
   `LoginForm.tsx`. BLOCKED on a real Supabase project to validate sign-in.
5. **Protected routes** — IMPLEMENTED. `middleware.ts` + `lib/supabase/middleware.ts`
   redirect unauthenticated users away from `/dashboard`, `/events`. BLOCKED
   on runtime validation.
6. **Supabase integration structure** — IMPLEMENTED. Separate browser
   (`lib/supabase/client.ts`), server (`lib/supabase/server.ts`), and
   middleware clients, each using only the anon key. No service-role usage
   anywhere in application code (confirmed by grep audit — see below).
7. **Database schema** — IMPLEMENTED (SQL written): `devices`, `device_state`,
   `commands`, `events` in `supabase/migrations/0001_init.sql`. BLOCKED on
   applying it to a real project.
8. **RLS policies** — IMPLEMENTED (policies written), BLOCKED on the
   3-point manual test checklist in the migration file (cross-user access
   attempts) against a live project.
9. **Device service abstraction** — IMPLEMENTED. `lib/device/service.ts` is
   the sole boundary the UI calls; switches on
   `NEXT_PUBLIC_DEVICE_DATA_SOURCE` between simulator and Supabase without UI
   changes.
10. **Simulator** — IMPLEMENTED. 8 scenarios in `lib/simulator/scenarios.ts`,
    engine in `lib/simulator/simulator.ts`. Confirmed isolated: only
    `lib/device/service.ts` imports it, and only when `SOURCE === "simulator"`.
    Development/testing only, per confirmed decision — not used to fake
    hardware integration.
11. **Dashboard** — IMPLEMENTED. `DashboardClient.tsx` + child components.
    Not yet rendered/visually verified.
12. **Tank visualization** — IMPLEMENTED. `TankLevel.tsx` derives both the
    numeric % and the fill height from the same `waterLevel` prop — no
    hard-coded level.
13. **Voltage state** — IMPLEMENTED. `VoltageCard.tsx` renders
    NORMAL/UNDER_VOLTAGE/OVER_VOLTAGE from `DeviceState.voltageState`.
14. **Pump state** — IMPLEMENTED, audited for the specific failure mode of
    optimistic updates: `pumpState` is only ever read from
    `state.pumpState`, sourced from `getDeviceState()`. No component sets it
    on click. See Critical Issues section below for full audit trail.
15. **AUTO/MANUAL** — IMPLEMENTED. `ModeToggle.tsx` sends a
    `SET_MODE_AUTO`/`SET_MODE_MANUAL` command request; does not flip mode
    locally.
16. **Command state machine** — IMPLEMENTED. `Command.status` transitions
    PENDING → RECEIVED → EXECUTED | REJECTED | FAILED, enforced in
    `lib/simulator/simulator.ts` (simulator path) and by construction in
    `app/api/commands/route.ts` (always inserts as PENDING; further
    transitions are for a not-yet-built ingest path to perform).
17. **Rejection reasons** — IMPLEMENTED. `Command.reason` populated on
    REJECTED, displayed in `CommandControls.tsx`.
18. **Request Current Level** — IMPLEMENTED as a command
    (`type: "REQUEST_LEVEL"`) with the same lifecycle as other commands —
    not a fake instant success.
19. **Event history** — IMPLEMENTED. `app/(dashboard)/events/page.tsx` +
    `EventList.tsx`, reads from simulator or `events` table depending on
    data source.
20. **ONLINE/OFFLINE** — IMPLEMENTED. Derived client-side from `lastSeen`
    via `getDisplayConnection()`, not trusted from a stored `deviceStatus`
    flag alone.
21. **STALE handling** — IMPLEMENTED, DRAFT threshold. Single source of
    truth: `lib/device/constants.ts` → `DEVICE_STALE_TIMEOUT_MS`, consumed
    only by `lib/device/staleness.ts`. Value is explicitly documented as
    provisional/placeholder pending hardware-team telemetry-interval
    confirmation (see `docs/WEB_APP_SPEC.md`) — not presented as a
    requirement anywhere.
22. **Error/loading states** — IMPLEMENTED. `DashboardClient.tsx` covers
    loading/error/stale/offline/normal branches; `CommandControls.tsx`
    covers command PENDING/RECEIVED/EXECUTED/REJECTED/FAILED. BLOCKED on
    manual fault-injection testing.
23. **PWA manifest** — IMPLEMENTED. `app/manifest.ts`. Icon PNGs are
    NOT IMPLEMENTED (placeholders only, see `public/icons/README.txt`).
24. **Service worker** — IMPLEMENTED per confirmed "app shell offline only"
    decision. `public/sw.js` caches only static shell routes
    (`/dashboard`, `/login`, manifest) and explicitly excludes `/api/*` from
    the fetch handler, so live telemetry is never served from cache. BLOCKED
    on real installability/offline testing (Lighthouse, real browser).
25. **Security** — IMPLEMENTED for what exists: no service-role key
    anywhere in application code (grep-audited), no `NEXT_PUBLIC_` secret
    exposure, RLS on all four tables, server-side command validation in
    `app/api/commands/route.ts`. NOT IMPLEMENTED: the ESP32 ingest endpoint
    and per-device token issuance/storage — deliberately not built pending
    your go-ahead, per confirmed architecture in `docs/DEVICE_API.md`.
26. **Environment variables** — IMPLEMENTED. `.env.example` documents all
    variables; service-role key is explicitly named as server-only and never
    prefixed `NEXT_PUBLIC_`.
27. **API routes** — IMPLEMENTED. `POST /api/commands` (insert-only, never
    writes `device_state`), `GET /api/device/[deviceId]` (read latest
    state). Both require a session; RLS is the second layer of enforcement.
28. **Documentation** — IMPLEMENTED and reconciled this pass: `WEB_APP_SPEC.md`,
    `DEVICE_API.md`, `UART_PROTOCOL.md` updated to match the confirmed
    decisions (ESP32 Bearer-token auth, provisional stale timeout, UART
    protocol explicitly unapproved).

## Critical-issue audit (items A–N from the audit request)

| # | Check | Result |
|---|-------|--------|
| A | Frontend directly modifying authoritative pump state | Not found. Only `lib/simulator/simulator.ts` (explicitly dev-only) ever assigns `pumpState`, and only after a command reaches `EXECUTED`. |
| B | pumpState changed immediately on START/STOP click | Not found. `sendCommand()` in `DashboardClient.tsx` only sets `activeCommand`; `state.pumpState` is untouched until a fresh `getDeviceState()` read. |
| C | Command creation treated as execution | Not found. `createCommand()` always returns `status: "PENDING"`; UI never renders PENDING as executed. |
| D | Stale telemetry displayed as live | Not found. Stale state visually distinguished (grayed values, banner, `ConnectionStatus`) and never re-labeled ONLINE from cache. |
| E | Hard-coded stale/offline timeout scattered across files | Not found. Single definition in `lib/device/constants.ts`; grep confirms no other file contains a raw timeout literal. |
| F | Service-role key exposed via `NEXT_PUBLIC_` | Not found. Grep confirms no `NEXT_PUBLIC_SERVICE_ROLE` or equivalent anywhere. |
| G | Device secret exposed to browser/client code | N/A — device secret/token mechanism is not yet implemented at all (correctly deferred, not fabricated). |
| H | Direct public ESP32 access architecture | N/A — no ESP32-facing endpoint exists yet in this repo. |
| I | Fake success response in a production path | Not found. `app/api/commands/route.ts` returns the real inserted row's status (`PENDING`), never a synthesized success. |
| J | Simulator used as real hardware integration | Not found. Simulator only reachable via the `NEXT_PUBLIC_DEVICE_DATA_SOURCE=simulator` branch in `lib/device/service.ts`. |
| K | Code assumes UART protocol is finalized | Not found. No application or database code references UART framing; `types/device.ts` and the schema use the abstract contract only. `UART_PROTOCOL.md` is now explicitly marked unapproved. |
| L | Undocumented database/RLS behavior | Corrected this pass — migration comments previously implied the ESP32 itself would hold a service-role key; reworded to match the confirmed Bearer-token architecture. |
| M | Incomplete command lifecycle | Not found — all five statuses implemented and reachable. |
| N | Service worker could serve stale telemetry as current | Not found. `public/sw.js` explicitly excludes `/api/*` from its cache-match handler. |

## Fixes made this pass
1. Reworded `supabase/migrations/0001_init.sql` comments (2 locations) and
   `README.md` to remove the implication that the ESP32 holds a Supabase
   service-role key — replaced with the confirmed per-device-secret +
   Bearer-token-to-a-server-endpoint architecture.
2. Rewrote `docs/DEVICE_API.md` to separate the abstract device contract
   (what the frontend depends on) from the ESP32 auth mechanism, and to
   state plainly that the ingest endpoint is not yet implemented.
3. Added explicit "DRAFT / PROPOSAL — NOT AN APPROVED HARDWARE SPECIFICATION"
   status line to `docs/UART_PROTOCOL.md`, and clarified the frontend does
   not depend on this document.
4. Reworded `.env.example` and `docs/WEB_APP_SPEC.md` stale-timeout language
   to state plainly this is a placeholder pending hardware-team input, not a
   requirement, and confirmed (via grep) it is defined in exactly one file.

No architectural changes were made beyond correcting these documentation/
comment inconsistencies — no new features, no framework changes, no backend
changes.

## Outstanding blockers
1. No network in this build environment → nothing installed, compiled, or
   executed. Local validation required (see below).
2. No real Supabase project connected → auth, RLS, realtime unverified.
3. UART protocol remains DRAFT — needs your + hardware team's confirmation.
4. ESP32 ingest endpoint and per-device token issuance are NOT IMPLEMENTED —
   deliberately deferred pending your approval to proceed.
5. PWA icon PNGs are NOT IMPLEMENTED (placeholders only).

## Typecheck fix log (this pass)
1. `lib/simulator/scenarios.ts` — added an explicit `ScenarioName` literal
   union and typed `SIMULATOR_SCENARIOS` as `Record<ScenarioName, DeviceState>`
   instead of `Record<string, DeviceState>`. With
   `noUncheckedIndexedAccess`, indexing a `Record<string, T>` is an
   index-signature lookup and correctly returns `T | undefined`; indexing a
   record keyed by a fixed literal union is a direct property access and does
   not. Since the scenario keys are in fact fixed at compile time, the fix is
   to make the type reflect that, not to assert the undefined away.
2. `lib/simulator/simulator.ts` — typed the `scenario` field as `ScenarioName`
   (was implicitly widened to `string`), updated `setScenario`/
   `getScenarioNames` to use `ScenarioName`/`SCENARIO_NAMES` accordingly. This
   resolved the `DeviceState | undefined` assignability error in
   `getDeviceState()` and the possibly-undefined errors in `resolve()` without
   touching `DeviceState`'s required fields.
3. `app/(dashboard)/events/page.tsx` — gave `events` an explicit
   `DeviceEvent[]` annotation instead of leaving it to implicit `any[]`.
4. `lib/supabase/server.ts` and `lib/supabase/middleware.ts` — imported
   `CookieOptions` from `@supabase/ssr` (the package actually installed, per
   `package.json`) and typed the `setAll` callback parameter as
   `{ name: string; value: string; options: CookieOptions }[]`, matching
   `@supabase/ssr`'s documented server-cookie-adapter signature rather than a
   type copied from an unrelated version or client.

No `@ts-ignore`/`@ts-nocheck`, no `any` casts, no relaxed `tsconfig.json`
settings, no optional fields added to `DeviceState`. I could not execute
`npm run typecheck` myself in this sandbox (no network/node_modules) — these
fixes are derived from the actual error causes and the installed package's
documented types, not verified by running the compiler. Please re-run and
report the result.

## Lint configuration fix (this pass)
Root cause of the interactive prompt: no ESLint config file had ever been
generated in this scaffold, and Next.js 15 pairs that with a deprecated
`next lint` that falls back to an interactive "Strict / Base / Cancel"
picker whenever no config exists.

Fix: added `eslint.config.mjs`, a flat ESLint 9 config that reuses Next's own
`next/core-web-vitals` and `next/typescript` rule sets (the same rules
`next lint`'s "Strict" option would have installed) via the
`@eslint/eslintrc` `FlatCompat` bridge — the officially documented migration
path for ESLint 9 + Next.js, not a hand-picked looser ruleset. Changed the
`lint` script from `next lint` to `eslint .`. Added `@eslint/eslintrc` as a
devDependency — required by this migration, not an unrelated package.
**Requires `npm install` again** before `npm run lint` will find it.
No rules were weakened, no `eslint-disable` comments added, and Next.js was
not downgraded.

## Local validation you need to run
```bash
npm install       # re-run: eslint.config.mjs migration added @eslint/eslintrc as a new devDependency
npm run typecheck
npm run lint
npm run build
```
Then, against a real Supabase project: apply `supabase/migrations/0001_init.sql`,
create two test users/devices, and run the 3-point RLS checklist documented
at the bottom of that migration file.

## What to send back
Paste (or summarize) the pass/fail output of each of the four commands above,
plus the outcome of the RLS checklist once you have a Supabase project to test
against. Nothing in this document will be upgraded to VALIDATED without that.
