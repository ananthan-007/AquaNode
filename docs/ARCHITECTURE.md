# AquaGuard Architecture — Two Identities

AquaGuard has **two separate identities**. Software must never conflate them.

## 1. Human User

- Creates an account and logs in through **Supabase Auth**.
- **Authentication** answers: *"Who is this person?"*
- **Authorization** answers: *"Is this person allowed to access/control this AquaGuard device?"*
- A user should only see and control devices they own (`devices.owner_id = auth.uid()`).
- Resolved via `lib/device/resolution.ts` (client) and `lib/device/resolution.server.ts` (RSC).

## 2. AquaGuard Device

- Each physical system has its own **device identity**, separate from any user.
- Eventually the ESP32 authenticates to the cloud with a **per-device credential**
  (`Authorization: Bearer <DEVICE_TOKEN>`) — not yet implemented.
- **Never** expose Supabase service-role credentials to the ESP32 or browser.
- Device telemetry is associated with the correct `devices.id`.
- Command status updates come from the device agent, not the PWA.

## Command Flow

When the user presses START, it is **only a command request**:

```
User → PWA → Cloud → ESP32 → UART → STM32 → safety validation → Pump
```

The STM32 remains the **final authority** and can EXECUTE or REJECT based on safety.

## Three Independent Layers

| Layer | Question | Where enforced |
|-------|----------|----------------|
| Authentication | Who are you? | Supabase Auth (session) |
| Authorization | Allowed to control this device? | RLS + `devices.owner_id` |
| STM32 Safety | Safe to execute? | Hardware (simulator in dev) |

## Software Boundaries

```
┌─────────────────────────────────────────────────────────┐
│  PWA (User-facing)                                      │
│  DashboardClient → lib/device/service.ts                 │
└──────────────────────────┬──────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     (simulator mode)            (supabase mode)
              │                         │
     lib/device/sim-cloud.ts     Supabase tables
              │                         │
              │                  POST /api/device/ingest
              │                  (not yet implemented)
              │                         │
     lib/simulator/simulator.ts  ESP32 + STM32
     (virtual device agent)      (physical device agent)
```

- **`lib/device/service.ts`** — sole boundary the UI calls (user path).
- **`lib/device/sim-cloud.ts`** — in-memory cloud for simulator mode; mirrors Supabase tables.
- **`lib/simulator/simulator.ts`** — virtual device agent (ESP32 + STM32); talks to cloud only.
- **`/simulator` control panel** — dev tool that talks directly to the device agent (fault injection).

## Replacing the Simulator

When hardware is ready:

1. Set `NEXT_PUBLIC_DEVICE_DATA_SOURCE=supabase`.
2. Implement ingest endpoint with per-device Bearer token validation.
3. ESP32 polls/receives commands and posts telemetry via ingest.
4. **No PWA changes** — same `service.ts` interface, same command lifecycle UI.

Hardware-specific details (UART framing, telemetry intervals, credential provisioning)
are intentionally **not** invented in software until the physical layer is ready.
See `docs/DEVICE_API.md` and `docs/UART_PROTOCOL.md`.
