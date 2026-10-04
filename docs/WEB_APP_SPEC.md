# AquaGuard Web App — Frozen Requirement Set (Phase 0)

Source of truth: `AquaGuard_WebApp_Requirements.pdf` + master build prompt.
This file is a restatement for engineering reference, not a reinterpretation.

## Architecture
User → PWA (HTTPS) → Cloud/Backend (Supabase) → ESP32 (Wi-Fi gateway) ↔ UART ↔ STM32 → sensors/relay/pump.

STM32 is the final safety and pump-control authority. PWA/backend/ESP32 may only
REQUEST actions; none may bypass STM32 safety logic or drive the relay directly.

## MVP scope (implemented in this build)
- Auth: Supabase Auth, protected dashboard, logout.
- Dashboard: water level % + visual tank, voltage + state (NORMAL/UNDER/OVER),
  pump ON/OFF, mode AUTO/MANUAL, dry-run status, fault condition, ONLINE/OFFLINE,
  last-seen, explicit stale-data indication, command status, "Request Current Level".
- Remote control: AUTO/MANUAL selection, START/STOP requests in MANUAL, command
  lifecycle PENDING → RECEIVED → EXECUTED | REJECTED | FAILED, rejection reason shown.
- Faults represented: dry-run, under-voltage, over-voltage, water-level sensor fault,
  voltage-sensor fault, flow/source sensor fault (if implemented), STM32 comms failure,
  ESP32/cloud failure.
- Cloud/backend: authenticated device access, latest device state, command storage +
  status tracking, last_seen, event storage.
- PWA: manifest, icons, standalone display, service worker, offline/stale states, HTTPS
  required in production.
- Security: RLS in Postgres, no secrets in client bundle, command validation server-side.

## Explicitly deferred (Phase-2, NOT built here)
Historical graphs (water level, voltage), pump runtime analytics, dry-run history,
push notifications, multi-device support, device naming/config, ESP32 OTA.

## Undetermined items flagged, not invented as requirements
- **Stale/offline timeout**: not specified by source docs, and NOT finalized as a project
  requirement. Kept as a single configurable constant (`DEVICE_STALE_TIMEOUT_MS` in
  `lib/device/constants.ts`, surfaced via `.env.example`) rather than hard-coded in
  multiple components. Current default (30000ms) is a placeholder pending the hardware
  team confirming the ESP32's real telemetry publish interval — do not treat this number
  as an official requirement or copy it elsewhere in the code.
- **STM32 ↔ ESP32 UART protocol**: not fixed by source docs. A draft JSON protocol is
  proposed in `docs/UART_PROTOCOL.md`, explicitly marked
  "DRAFT / PROPOSAL — NOT AN APPROVED HARDWARE SPECIFICATION". The web app's device
  contract (`docs/DEVICE_API.md`) is framing-agnostic and does not depend on this draft
  being finalized.
- **ESP32 → Cloud authentication**: confirmed as per-device secret +
  `Authorization: Bearer <DEVICE_TOKEN>` against a dedicated server-side ingest endpoint.
  The ESP32 never holds a Supabase service-role or anon key. The ingest endpoint itself
  is not yet implemented (see `docs/DEVICE_API.md`).
