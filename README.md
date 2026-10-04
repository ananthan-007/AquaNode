# AquaGuard PWA

Remote monitoring and control dashboard for the AquaGuard water-pump system.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS · Supabase (Auth / Postgres / Realtime) · Vercel

**Architecture:**

```
Browser PWA  →  Vercel (Next.js)  →  Supabase  ←  ESP32 (Wi-Fi gateway)
                                                         ↕  UART 115200 8N1
                                                       STM32 (safety authority)
                                                         ↕
                                               sensors · relay · pump
```

The STM32 is the final safety and pump-control authority. Nothing upstream can
bypass it. The ESP32 is the only cloud-connected hardware device. The PWA never
connects directly to `192.168.x.x`, mDNS, or a local device WebSocket.

---

## Quick start (simulator mode — no hardware required)

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project values
npm run dev
```

Sign in, and the dashboard runs on the built-in simulator. All sensor readings,
pump commands, and fault injection work without any physical hardware.

To open the hidden hardware Connect Mode: press **Space 5×** in rapid succession.

---

## Development commands

```bash
npm run dev        # start local dev server
npm run typecheck  # TypeScript — must exit 0
npm run lint       # ESLint — must exit 0
npm test           # Vitest — must pass (131 tests)
npm run build      # production build — must compile cleanly
```

---

## Project structure

```
app/                   Next.js App Router pages and API routes
  (auth)/              Login, signup, forgot/reset-password
  (dashboard)/         Protected dashboard, events, simulator
  api/
    commands/          POST /api/commands (user command requests)
    admin/
      provision-device-token/   POST — generate per-device ESP32 tokens
    device/
      devices/         GET  — ESP32 auto-discovery list
      handshake/       POST — two-phase live hardware handshake
      handshake/verify/GET  — poll handshake challenge result
      ingest/          POST — ESP32 heartbeat/telemetry receiver
      commands/        GET  — ESP32 pending-command poll
      [deviceId]/      GET  — single device state

components/
  connect-mode/        Hidden hardware Connect Mode overlay (Space×5)
  dashboard/           All dashboard UI components
  auth/                Login form

lib/
  device/
    constants.ts       Heartbeat thresholds, challenge TTL
    token-auth.ts      SHA-256 token hashing and provisioning helpers
    providers/         SimulatorProvider, HardwareProvider
    transports/        CloudTransport (Vercel-compatible REST+poll)
  simulator/           Virtual ESP32+STM32 engine for development
  supabase/            Client, server, middleware helpers

hardware/
  esp32/
    aquaguard_esp32.ino    ESP32 Arduino firmware (Wi-Fi gateway)
  stm32/
    aquaguard_hal.h        Hardware abstraction interface (implement this)
    aquaguard_protocol.h   Protocol layer public API
    aquaguard_protocol.c   UART protocol implementation
    aquaguard_main.c       main() entry point
    aquaguard_hal_stub.c   Stub HAL for host-side testing
    test_protocol.c        71 C unit tests (runs on PC, no hardware needed)
    Makefile               make test / make stm32 / make flash

supabase/migrations/
  0001_init.sql            Core schema (devices, device_state, commands, events)
  0002_hardware_ingest.sql device_tokens table + indexes
  0003_esp32_discovery.sql firmware_version, stm32_connected, last_telemetry_at
  0004_esp32_open_registry.sql device_registry (no user FK required)
  0005_handshake_challenges.sql Live challenge/response nonces
  0006_token_provisioning.sql  registry_device_id, nullable device_id
  0007_dev_device_token.sql    Pre-provisioned dev device token

docs/
  ARCHITECTURE.md        System design and software boundaries
  HARDWARE_INTEGRATION.md Full integration guide with curl test commands
  UART_PROTOCOL.md       ESP32 ↔ STM32 JSON protocol (6 frame types)
  DEVICE_API.md          Cloud ↔ ESP32 API contract
  WEB_APP_SPEC.md        Frozen requirement set
```

---

## Vercel deployment

1. Push to GitHub and import in [Vercel](https://vercel.com/new). Preset: **Next.js**, Node.js 20+.

2. Set environment variables (Production + Preview):

   | Variable | Value |
   |----------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon public` key from the same page |
   | `NEXT_PUBLIC_DEVICE_DATA_SOURCE` | `simulator` (dev) or `supabase` (with hardware) |
   | `NEXT_PUBLIC_SITE_URL` | `https://your-app.vercel.app` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role key — **server-only, never `NEXT_PUBLIC_`** |

   Optional:

   | Variable | Default | Purpose |
   |----------|---------|---------|
   | `HEARTBEAT_ONLINE_MS` | `25000` | ms without heartbeat before STALE |
   | `HEARTBEAT_OFFLINE_MS` | `60000` | ms without heartbeat before OFFLINE |
   | `CHALLENGE_TTL_MS` | `15000` | Live handshake nonce TTL |
   | `HARDWARE_DEVICE_TOKEN` | *(disabled in prod)* | Dev bypass token — never set in production |

3. In Supabase → **Authentication → URL Configuration**:
   - Site URL: `https://your-app.vercel.app`
   - Redirect URLs: `https://your-app.vercel.app/auth/callback`
   - Add `http://localhost:3000/auth/callback` for local dev

4. Apply all migrations in order:
   ```bash
   # In your Supabase project's SQL editor, run each file in sequence:
   supabase/migrations/0001_init.sql
   supabase/migrations/0002_hardware_ingest.sql
   supabase/migrations/0003_esp32_discovery.sql
   supabase/migrations/0004_esp32_open_registry.sql
   supabase/migrations/0005_handshake_challenges.sql
   supabase/migrations/0006_token_provisioning.sql
   supabase/migrations/0007_dev_device_token.sql   # dev device only
   ```

---

## Connecting real hardware

### Architecture (no direct browser ↔ ESP32 connection)

```
ESP32  →  HTTPS POST /api/device/ingest  (Bearer token auth)
       ←  GET  /api/device/commands/pending  (polls every 2 s)
PWA    →  GET  /api/device/devices           (discovery list)
       →  POST /api/device/handshake          (two-phase connect)
       →  GET  /api/device/handshake/verify   (poll for challenge response)
```

### ESP32 firmware setup

1. Open `hardware/esp32/aquaguard_esp32.ino` in Arduino IDE.
2. Set your values:
   ```cpp
   #define WIFI_SSID     "your-network"
   #define WIFI_PASSWORD "your-password"
   #define BACKEND_URL   "https://your-app.vercel.app"
   #define DEVICE_TOKEN  "REPLACE_WITH_DEVICE_TOKEN"
   // For development testing only:
   // #define DEVICE_TOKEN "dev-device-token-secret"
   // Also add: #define AQUAGUARD_DEV_MODE  (disables TLS cert validation)
   ```
3. Flash to an ESP32 Dev Module (board: *esp32 → ESP32 Dev Module*).
4. The ESP32 derives its Device ID automatically from the MAC address:
   `AQ-ESP32-XXXXXXXXXXXX`

### Production token provisioning

Each ESP32 must have its own unique 64-char hex token (SHA-256 stored in DB,
raw token only in firmware — never in the database).

```bash
# 1. Let the ESP32 send one heartbeat with the dev token
#    so it appears in device_registry.

# 2. Provision a production token (requires authenticated session):
curl -X POST https://your-app.vercel.app/api/admin/provision-device-token \
  -H "Cookie: <your-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"registryDeviceId":"AQ-ESP32-XXXXXXXXXXXX","description":"Unit 1"}'

# Response contains "rawToken" — set as DEVICE_TOKEN in firmware and reflash.
# The token is shown once. Store it in your password manager.
```

The development device token (migration 0007) is pre-provisioned for the
device ID `AQ-ESP32-DEV000000001`:
```
Raw token: 13e4b82a975563620ab3597132ca3c32fa3f499805934e3d457441afaaa8fee0
```
Set `#define DEVICE_TOKEN "13e4b82a..."` in firmware for bench testing.

### STM32 firmware setup

The UART protocol implementation is in `hardware/stm32/`. It is a portable
C99 library that works on any STM32 once the hardware abstraction layer is
implemented.

**Build and test on a PC (no hardware required):**
```bash
cd hardware/stm32
make test       # builds with stub HAL and runs 71 C unit tests
```

**Port to your STM32 board:**
1. Implement every function in `aquaguard_hal.h` in a new file
   `aquaguard_hal_stm32.c`. See the header for exactly what each function
   must do. The functions that need hardware-specific information:
   - `HAL_UART_ESP32_Init/Transmit/ReceiveByte` — which USART? which pins?
   - `HAL_WaterLevel_ReadPercent/IsFault` — sensor type, ADC channel, scaling
   - `HAL_Voltage_ReadVolts/IsFault` — ADC channel, divider ratio
   - `HAL_Flow_IsNone/IsFault` — flow sensor type and GPIO
   - `HAL_Relay_PumpOn/PumpOff/IsOn` — relay GPIO and polarity
   - `HAL_Sys_GetTickMs` — `HAL_GetTick()` or SysTick counter
   - `HAL_Sys_Init` — all peripheral clock/GPIO/ADC init

2. Add your toolchain startup file and linker script.

3. For production TLS: replace `#define AQUAGUARD_DEV_MODE` with the
   actual root CA PEM in `AQUAGUARD_ROOT_CA[]` inside the `.ino` file.

**Cross-compile for STM32 (requires `arm-none-eabi-gcc`):**
```bash
cd hardware/stm32
make stm32      # produces aquaguard.elf
make flash      # flashes via OpenOCD + ST-Link
```

### Testing without hardware (curl)

```bash
# Heartbeat (ESP32 alive, STM32 connected)
curl -X POST http://localhost:3000/api/device/ingest \
  -H "Authorization: Bearer dev-device-token-secret" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"AQ-ESP32-TESTDEV1","type":"heartbeat","firmwareVersion":"1.0.0","stm32Connected":true}'

# Telemetry
curl -X POST http://localhost:3000/api/device/ingest \
  -H "Authorization: Bearer dev-device-token-secret" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"AQ-ESP32-TESTDEV1","type":"telemetry","stm32Connected":true,"telemetry":{"waterLevel":65,"voltage":230,"voltageState":"NORMAL","pumpState":"OFF","mode":"AUTO","dryRun":false,"fault":null,"sequence":1}}'

# Verify discovery
curl http://localhost:3000/api/device/devices

# Trigger handshake
curl -X POST http://localhost:3000/api/device/handshake \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"AQ-ESP32-TESTDEV1"}'
```

Then in the PWA: press **Space 5×** → **Connect Real Hardware** → select the
device → **Connect**. The handshake issues a live challenge nonce that the
real ESP32 must echo back within 15 seconds via `/api/device/ingest`.

---

## How the handshake works

Clicking **Connect** performs a genuine two-phase end-to-end verification:

```
Phase 1 — DB pre-check:
  PWA → POST /api/device/handshake
      ← checks last_seen freshness (ONLINE/STALE within 60 s)
      ← checks stm32_connected = true (ESP32 confirmed UART link)
      ← checks last_telemetry_at within 60 s
      ← issues a random 32-byte nonce into device_challenges

Phase 2 — Live challenge:
  ESP32 picks up nonce via GET /api/device/commands/pending
  ESP32 POSTs nonce back: POST /api/device/ingest { type: "challenge_response" }
  PWA polls GET /api/device/handshake/verify?challengeId=...
      ← returns verified: true when ESP32 echoes the nonce
```

The dashboard only switches to live hardware data after both phases pass.
Database freshness alone is not enough.

---

## Heartbeat thresholds

| Age of last heartbeat | Dashboard status |
|-----------------------|-----------------|
| ≤ 25 s (3 missed × 8 s + buffer) | ONLINE |
| 25 s – 60 s | STALE |
| > 60 s | OFFLINE |

Thresholds are derived server-side at query time. The firmware sends
heartbeats every 8 s so three consecutive missed packets still stay ONLINE.

---

## ESP32 ↔ STM32 UART protocol summary

115200 8N1, newline-delimited JSON, protocol version `"v": 1`.

| Direction | Frame | Purpose |
|-----------|-------|---------|
| ESP32 → STM32 | `{"v":1,"type":"PING"}` | Keepalive every 10 s |
| STM32 → ESP32 | `{"v":1,"type":"PONG"}` | Liveness reply (within 2 s) |
| ESP32 → STM32 | `{"v":1,"type":"REQUEST_TELEMETRY"}` | Poll every 5 s |
| STM32 → ESP32 | `{"v":1,"seq":N,"waterLevel":…,"fault":null}` | Full telemetry |
| ESP32 → STM32 | `{"v":1,"cmdId":"…","type":"PUMP_ON"}` | Command relay |
| STM32 → ESP32 | `{"v":1,"cmdId":"…","result":"EXECUTED","reason":null}` | Command result |

`fault` is always JSON `null` (not the string `"null"`) when no fault is active.
See `docs/UART_PROTOCOL.md` for the full frame specification and the list of
things that still need hardware-team confirmation.

---

## Security

- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are
  sent to the browser. No service-role key is in the client bundle.
- RLS is enabled on all tables. The browser client can never write
  `device_state` or advance `commands.status`.
- ESP32 Bearer tokens are stored as SHA-256 hashes only. The raw token is
  shown once during provisioning and never stored in the database.
- The dev bypass token (`dev-device-token-secret`) is unconditionally
  rejected when `NODE_ENV=production`, regardless of env var configuration.
- Production ESP32 firmware requires TLS CA-pinning
  (`AQUAGUARD_ROOT_CA[]`). `AQUAGUARD_DEV_MODE` must not be defined in
  production builds.
- Commands are requests only. The STM32 controller is the final safety
  authority and can reject any command regardless of what the PWA sends.
