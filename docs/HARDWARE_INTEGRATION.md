# AquaGuard Hardware Integration & Protocol Guide

This document defines the software boundary, authentication mechanism, API payloads, command lifecycle, and hardware protocol mappings for connecting a physical **ESP32 + STM32** controller system to the AquaGuard cloud & PWA.

---

## 1. Physical System Architecture

```
┌─────────────────────────────────────────────────────────┐
│ STM32 Microcontroller (Safety & Relay Authority)        │
│   - Reads water level sensors (0–100%)                  │
│   - Measures line voltage & dry-run conditions          │
│   - Controls physical Pump Relay (ON/OFF)               │
│   - Enforces physical safety checks                     │
└──────────────────────────┬──────────────────────────────┘
                           │ UART (115200 8N1)
                           │ RX2/TX2 on ESP32
┌──────────────────────────┴──────────────────────────────┐
│ ESP32 Wi-Fi / Cloud Gateway                             │
│   - Derives stable Device ID from MAC address           │
│     (format: AQ-ESP32-XXXXXXXXXXXX)                     │
│   - Connects outbound to configured BACKEND_URL         │
│   - Authenticates with Bearer token                     │
│   - Sends heartbeats every ~8 seconds                   │
│   - Pings STM32 over UART to verify link                │
│   - Forwards telemetry from STM32 to backend            │
│   - Polls backend for PENDING commands                  │
│   - Relays commands to STM32 over UART                  │
│   - Reports command results (EXECUTED / REJECTED)       │
│   - Auto-reconnects after Wi-Fi or backend failures     │
│   - NEVER exposes a local HTTP server or WebSocket      │
│   - NEVER requires the PWA to know its LAN IP           │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS POST (outbound only)
                           │ Authorization: Bearer <DEVICE_TOKEN>
┌──────────────────────────┴──────────────────────────────┐
│ AquaGuard Cloud / Next.js on Vercel + Supabase          │
│   POST /api/device/ingest   ← ESP32 heartbeats/telemetry│
│   GET  /api/device/commands/pending ← ESP32 command poll│
│   GET  /api/device/devices  ← PWA discovery             │
│   POST /api/device/handshake ← PWA connect handshake    │
│   POST /api/commands        ← PWA command requests      │
└──────────────────────────┬──────────────────────────────┘
                           │ Supabase Realtime / polling
┌──────────────────────────┴──────────────────────────────┐
│ AquaGuard PWA (Vercel)                                  │
│   Connect Mode → discovery → select ESP32 → handshake  │
│   Dashboard → live telemetry → command controls         │
└─────────────────────────────────────────────────────────┘
```

**Critical architectural rules:**
- The ESP32 makes **outbound** connections to the cloud. It is never publicly reachable as a server.
- The PWA never connects directly to `192.168.x.x`, mDNS, or a local ESP32 WebSocket.
- The STM32 is never independently discovered by the PWA. It is only "connected" when the ESP32 confirms successful UART communication (`stm32Connected: true`).

---

## 2. ESP32 Auto-Discovery Flow

When the user clicks "Connect Real Hardware" in the Connect Mode overlay:

```
1. PWA → GET /api/device/devices
         ↓
2. Backend reads device_registry table
   (ESP32s self-register by sending heartbeats)
         ↓
3. PWA displays list of registered ESP32 devices
   with derived ONLINE/STALE/OFFLINE status
         ↓
4. User selects a device and clicks "Connect"
         ↓
5. PWA → POST /api/device/handshake { deviceId }
         ↓
6. Backend verifies:
   a) ESP32 heartbeat is fresh (last_seen < 10s → ONLINE)
   b) ESP32 reports stm32_connected = true
   c) Telemetry was received in last 60 seconds
         ↓
7. If all three pass: verified = true
   PWA activates CloudTransport + HardwareProvider
   Dashboard uses live ESP32/STM32 telemetry
```

**No scanning, no mDNS, no 192.168.x.x — backend-powered only.**

---

## 3. Ingest API Specification

### Endpoint: `POST /api/device/ingest`

**Headers:**
```http
Content-Type: application/json
Authorization: Bearer <DEVICE_TOKEN>
```

**Dev token** (local testing, no DB setup): `dev-device-token-secret`
Set `HARDWARE_DEVICE_TOKEN` env var to disable the dev token in production.

---

### A. Heartbeat (`type: "heartbeat"`)
Sent every ~8 seconds (within the 10-second ONLINE threshold).

```json
{
  "deviceId": "AQ-ESP32-AABBCCDDEE00",
  "type": "heartbeat",
  "firmwareVersion": "1.0.0",
  "stm32Connected": true
}
```

- `stm32Connected`: `true` if ESP32 received a PONG from STM32 within the last UART ping cycle; `false` otherwise.
- Writing this to `device_registry` allows the PWA to discover the device via `GET /api/device/devices`.

---

### B. Telemetry (`type: "telemetry"`)
Sent every 5 seconds (or on state change).

```json
{
  "deviceId": "AQ-ESP32-AABBCCDDEE00",
  "type": "telemetry",
  "firmwareVersion": "1.0.0",
  "stm32Connected": true,
  "telemetry": {
    "waterLevel": 68,
    "voltage": 228.5,
    "voltageState": "NORMAL",
    "pumpState": "OFF",
    "mode": "AUTO",
    "dryRun": false,
    "fault": null,
    "deviceStatus": "ONLINE",
    "sequence": 1042
  }
}
```

---

### C. Command Result (`type: "command_result"`)

```json
{
  "deviceId": "AQ-ESP32-AABBCCDDEE00",
  "type": "command_result",
  "commandId": "uuid-from-commands-table",
  "status": "EXECUTED",
  "reason": null
}
```

Allowed `status` values: `RECEIVED`, `EXECUTED`, `REJECTED`, `FAILED`.

---

### D. Command Poll: `GET /api/device/commands/pending?deviceId=<id>`

ESP32 polls this every 2 seconds to fetch PENDING commands:

```json
{
  "commands": [
    { "id": "uuid", "type": "PUMP_ON", "status": "PENDING" }
  ]
}
```

---

## 4. STM32 UART Verification

The ESP32 firmware implements a PING/PONG verification:

```
ESP32 sends:   {"v":1,"type":"PING"}\n
STM32 replies: {"v":1,"type":"PONG"}\n
```

If STM32 does not respond within `UART_RESPONSE_TIMEOUT_MS` (2 seconds):
- `stm32Connected` is set to `false`
- Next heartbeat reports `stm32Connected: false`
- PWA shows "STM32: Unavailable"

For command relay:
```
ESP32 sends:   {"v":1,"cmdId":"abc123","type":"PUMP_ON"}\n
STM32 replies: {"v":1,"cmdId":"abc123","result":"EXECUTED","reason":null}\n
```

See `docs/UART_PROTOCOL.md` for the full draft protocol (not yet approved by hardware team).

---

## 5. Device Status Thresholds (server-side)

| Age of last_seen | Status  |
|-----------------|---------|
| ≤ 10 seconds    | ONLINE  |
| 10–30 seconds   | STALE   |
| > 30 seconds    | OFFLINE |

These thresholds are derived server-side at query time from `last_seen`, not from a stored `device_status` column. The firmware sends heartbeats every 8 seconds to stay within the ONLINE window.

---

## 6. Connection Verification Requirements

The handshake endpoint (`POST /api/device/handshake`) returns `verified: true` only when **all three** are satisfied:

| Check | Requirement |
|-------|------------|
| ESP32 heartbeat | `last_seen` within 30 seconds (ONLINE or STALE) |
| STM32 UART | `stm32_connected = true` reported by ESP32 |
| Telemetry freshness | `last_telemetry_at` within last 60 seconds |

If any check fails, the connection is not verified and the dashboard remains in simulator mode.

---

## 7. ESP32 Firmware Configuration

Edit these constants in `hardware/esp32/aquaguard_esp32.ino` before flashing:

```cpp
#define WIFI_SSID        "YOUR_WIFI_SSID"
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"
#define BACKEND_URL      "https://your-app.vercel.app"
#define DEVICE_TOKEN     "dev-device-token-secret"
#define FIRMWARE_VERSION "1.0.0"
```

The `DEVICE_ID` is derived automatically from the ESP32's MAC address at runtime:
```
AQ-ESP32-XXXXXXXXXXXX  (12 hex chars of MAC)
```

**The backend URL goes in the firmware, not in the PWA.**

---

## 8. Testing Without Hardware

Run the dev server and POST directly to the ingest endpoint:

```bash
# Send heartbeat (ESP32 alive, STM32 connected)
curl -X POST http://localhost:3000/api/device/ingest \
  -H "Authorization: Bearer dev-device-token-secret" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"AQ-ESP32-TESTDEV1","type":"heartbeat","firmwareVersion":"1.0.0","stm32Connected":true}'

# Send telemetry
curl -X POST http://localhost:3000/api/device/ingest \
  -H "Authorization: Bearer dev-device-token-secret" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"AQ-ESP32-TESTDEV1","type":"telemetry","stm32Connected":true,"telemetry":{"waterLevel":65,"voltage":230,"voltageState":"NORMAL","pumpState":"OFF","mode":"AUTO","dryRun":false,"fault":null,"sequence":1}}'

# Check discovery
curl http://localhost:3000/api/device/devices

# Trigger handshake (as the PWA would)
curl -X POST http://localhost:3000/api/device/handshake \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"AQ-ESP32-TESTDEV1"}'
```

Then open the PWA, press Space 5× to open Connect Mode, click "Connect Real Hardware", and you should see "AQ-ESP32-TESTDEV1" in the device list.

---

## 9. Production Token Provisioning

For production, provision a unique token per ESP32:

```sql
-- 1. Create a strong token (outside DB)
-- e.g. openssl rand -hex 32 → "abc123..."

-- 2. Store the token hash in Supabase (use pgcrypto or hash server-side)
INSERT INTO public.device_tokens (device_id, token_hash, description)
VALUES ('uuid-of-device-row', 'sha256-of-token', 'ESP32 AQ-ESP32-AABBCC');
```

Then set `DEVICE_TOKEN` in the ESP32 firmware to the raw (unhashed) token.

Unset `HARDWARE_DEVICE_TOKEN` in production `.env` so the dev bypass token is disabled.
