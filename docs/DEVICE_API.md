# Device API Contract (Abstract Cloud ⇄ ESP32 ⇄ PWA Contract)

This document describes the **abstract data/command contract** the web
application depends on. It intentionally does not assume a specific UART
wire format — see `UART_PROTOCOL.md`, which is a separate, unapproved draft.
The frontend and backend schema depend only on the concepts below, not on
STM32↔ESP32 framing details.

## Concepts required by the project requirements (not invented)
Telemetry: water level, voltage, voltage state, pump state, mode, dry-run
state, fault state, sensor status (where implemented), timestamp/sequence.

Commands: pump ON request, pump OFF request, AUTO/MANUAL mode request,
fault-reset request (only where permitted), request-current-level.

Command result: acknowledgement or rejection + reason, returned by STM32 via
ESP32 to the cloud.

## HTTP surface exposed to the PWA (implemented)
### `POST /api/commands`
Body: `{ deviceId: string, type: CommandType, payload?: Record<string, unknown> }`
Response: `{ commandId: string, status: "PENDING" }`
Auth: requires a valid Supabase user session; RLS additionally enforces the
caller owns `deviceId`. This endpoint only ever inserts a `commands` row — it
never writes `device_state` directly (see "Important Distinction" rule).

### `GET /api/device/[deviceId]`
Response: latest `device_state` row + `last_seen`, derived `connection` status.
Auth: same as above.

## ESP32 → Cloud authentication (CONFIRMED architecture — not yet implemented)
Per the confirmed decision, the ESP32 authenticates to a dedicated,
server-side ingest endpoint using a **per-device secret credential**, sent as:

```
Authorization: Bearer <DEVICE_TOKEN>
```

- The ESP32 never holds a Supabase service-role key, anon key, or any
  Supabase credential at all.
- `<DEVICE_TOKEN>` is a secret issued per device, stored server-side (e.g.
  hashed in a `device_credentials` table — not yet created), and validated by
  the ingest endpoint before it is allowed to write `device_state`/`events` or
  update `commands.status`.
- The ingest endpoint itself (not the ESP32) is the only component with
  elevated write access to those tables.
- The ESP32 must not be directly exposed to the public internet as an
  inbound service — it only makes outbound calls to this endpoint.

**Not yet implemented in this repo**: the ingest endpoint (`POST
/api/device/ingest` or similar), the device-token issuance/storage
mechanism, and the `device_credentials` schema. These were intentionally
left out pending your go-ahead, per the "stop adding new features" audit
instruction — this section exists to record the confirmed shape so the next
implementation pass has a fixed target.

## Open item
Exact request/response shape for the ingest endpoint is not yet specified —
flagging this as a decision to make explicitly before building it, not
something to infer.
