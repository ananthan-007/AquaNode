# STM32 ⇄ ESP32 UART Protocol

## Status

**DRAFT — pending hardware-team sign-off before firmware is finalised.**

The web application does not depend on UART framing. It depends only on the
abstract device-state contract in `docs/DEVICE_API.md`. This document describes
the on-wire format used by the current ESP32 firmware
(`hardware/esp32/aquaguard_esp32.ino`) so the STM32 author has a concrete
target. No changes to the PWA or database schema are needed when this protocol
is revised.

---

## Transport

| Parameter   | Value              |
|-------------|--------------------|
| Interface   | UART2 on ESP32     |
| Baud rate   | 115 200            |
| Frame format | 8N1               |
| Encoding    | Newline-delimited JSON (`\n` terminated, one object per line) |
| Direction   | Full-duplex        |
| ESP32 RX pin | GPIO 16           |
| ESP32 TX pin | GPIO 17           |

---

## Protocol version field

Every frame includes `"v": 1`. The ESP32 firmware ignores frames whose `v`
field it does not recognise. The STM32 should do the same. Increment `v` on
any breaking schema change and keep backward compatibility for one release.

---

## Frame catalogue

### 1. ESP32 → STM32: PING (UART link keepalive)

Sent every 10 seconds by the ESP32 to confirm the UART link is alive.

```json
{"v":1,"type":"PING"}
```

**STM32 must respond within 2 seconds** (see §2). If no response, the ESP32
sets `stm32Connected = false` and the next heartbeat to the cloud will reflect
this. The PWA will show "STM32: Unavailable".

---

### 2. STM32 → ESP32: PONG (UART link response)

```json
{"v":1,"type":"PONG"}
```

No additional fields required. The presence of this response within the timeout
window is the only liveness signal the ESP32 needs.

---

### 3. ESP32 → STM32: REQUEST_TELEMETRY

Sent every 5 seconds (when STM32 is known to be connected).

```json
{"v":1,"type":"REQUEST_TELEMETRY"}
```

**STM32 must respond within 2 seconds** with a TELEMETRY frame (see §4).

---

### 4. STM32 → ESP32: TELEMETRY

Response to REQUEST_TELEMETRY. All fields are required unless marked optional.

```json
{
  "v": 1,
  "seq": 10432,
  "waterLevel": 62,
  "voltage": 228.5,
  "voltageState": "NORMAL",
  "pumpState": "OFF",
  "mode": "AUTO",
  "dryRun": false,
  "fault": null
}
```

| Field        | Type              | Description |
|--------------|-------------------|-------------|
| `v`          | integer           | Protocol version, currently `1` |
| `seq`        | integer           | Monotonic counter. ESP32 uses this as `sequence` in cloud telemetry. Start at 0 at boot; wrap at 2³¹. |
| `waterLevel` | integer 0–100     | Tank fill percentage |
| `voltage`    | float             | Line voltage in volts |
| `voltageState` | string          | `"NORMAL"` \| `"UNDER_VOLTAGE"` \| `"OVER_VOLTAGE"` |
| `pumpState`  | string            | `"ON"` \| `"OFF"` |
| `mode`       | string            | `"AUTO"` \| `"MANUAL"` |
| `dryRun`     | boolean           | `true` when dry-run condition is active |
| `fault`      | string \| null    | Fault code string or JSON `null` when no fault. **Must be JSON `null`, not the string `"null"`.** See fault codes below. |

**Fault codes** (matches `Fault` union in `types/device.ts`):

| Code | Meaning |
|------|---------|
| `null` | No fault |
| `"DRY_RUN"` | Pump running but no water flow detected |
| `"UNDER_VOLTAGE"` | Line voltage below safe threshold |
| `"OVER_VOLTAGE"` | Line voltage above safe threshold |
| `"WATER_LEVEL_SENSOR_FAULT"` | Level sensor unresponsive or out of range |
| `"VOLTAGE_SENSOR_FAULT"` | Voltage sensor unresponsive or out of range |
| `"FLOW_SENSOR_FAULT"` | Flow sensor unresponsive or out of range |
| `"STM32_COMM_FAILURE"` | Internal STM32 self-diagnosis failure |

**Important:** `fault` must be the JSON value `null` (not the string
`"null"`, not `""`) when no fault is active. The ESP32 firmware converts an
empty string from the `|` fallback operator to the correct JSON `null` in the
ingest payload — but the cleanest approach is for the STM32 to emit `null`
directly.

---

### 5. ESP32 → STM32: COMMAND

Relayed from a cloud command. The STM32 is the safety authority and may reject
any command.

```json
{"v":1,"cmdId":"abc-123-uuid","type":"PUMP_ON"}
```

| Field    | Type   | Description |
|----------|--------|-------------|
| `v`      | integer | Protocol version |
| `cmdId`  | string  | UUID from the cloud `commands` table. Must be echoed in the response. |
| `type`   | string  | One of the command types below |

**Command types:**

| Type | Description |
|------|-------------|
| `PUMP_ON` | Start the pump (MANUAL mode only; safety checks enforced by STM32) |
| `PUMP_OFF` | Stop the pump |
| `SET_MODE_AUTO` | Switch to automatic level control |
| `SET_MODE_MANUAL` | Switch to manual control |
| `FAULT_RESET` | Clear latched faults (only effective if the underlying cause has been resolved) |
| `REQUEST_LEVEL` | Trigger an immediate telemetry response (same format as §4) |

**STM32 must respond within 5 seconds** with a COMMAND_RESULT frame (§6).

---

### 6. STM32 → ESP32: COMMAND_RESULT

Response to a COMMAND frame.

```json
{"v":1,"cmdId":"abc-123-uuid","result":"EXECUTED","reason":null}
```

| Field    | Type            | Description |
|----------|-----------------|-------------|
| `v`      | integer         | Protocol version |
| `cmdId`  | string          | Must match the `cmdId` from the COMMAND frame |
| `result` | string          | `"EXECUTED"` \| `"REJECTED"` \| `"FAILED"` |
| `reason` | string \| null  | Rejection/failure reason code, or `null` on success |

**Result codes:**

| Result | Meaning |
|--------|---------|
| `"EXECUTED"` | STM32 carried out the command and the physical state has changed |
| `"REJECTED"` | STM32 refused the command (safety violation, wrong mode, etc.). Include a reason code. |
| `"FAILED"` | Command could not be processed due to an internal error |

**Rejection reason codes** (non-exhaustive; any descriptive string is acceptable):

| Reason | Meaning |
|--------|---------|
| `"UNDER_VOLTAGE"` | Line voltage too low to safely start pump |
| `"OVER_VOLTAGE"` | Line voltage dangerously high |
| `"DRY_RUN"` | Dry-run condition active — pump will not start |
| `"WRONG_MODE"` | Command not applicable in current operating mode |
| `"FAULT_ACTIVE"` | Unresolved fault prevents execution |
| `"TANK_FULL"` | Water level at maximum — pump start refused |

---

## STM32 required changes (vs previous draft)

The following changes are needed relative to the original UART_PROTOCOL.md
draft to match what the ESP32 firmware (`aquaguard_esp32.ino`) currently sends
and expects:

| Change | Reason |
|--------|--------|
| Add PING/PONG handler | ESP32 sends PING every 10 s; STM32 must reply PONG within 2 s or stm32Connected becomes false |
| Add REQUEST_TELEMETRY handler | ESP32 sends this every 5 s; STM32 must reply with TELEMETRY frame |
| Emit `"fault": null` (not `""` or `"null"`) | The ESP32 firmware correctly maps empty string to JSON null, but STM32 should emit `null` directly to avoid ambiguity |
| Include `"seq"` in TELEMETRY | Used as the cloud telemetry sequence counter; must be monotonically increasing |
| Remove `"ts"` field | The previous draft included a STM32 timestamp field `ts`. The ESP32 firmware does not read or forward this field. Omit it to save UART bandwidth, or include it — the ESP32 will ignore it. |
| Remove `"sensorStatus"` object | The previous draft included a `sensorStatus` nested object. The ESP32 firmware does not read it. Map sensor faults to the top-level `fault` field instead. |

---

## Timing summary

| Interval | Value | Notes |
|----------|-------|-------|
| PING from ESP32 | 10 s | STM32 must respond within 2 s |
| REQUEST_TELEMETRY from ESP32 | 5 s | STM32 must respond within 2 s |
| Heartbeat to cloud | 8 s | Keeps device ONLINE (threshold: 25 s) |
| Telemetry to cloud | 5 s | When stm32Connected=true |
| Command relay to STM32 | On demand (≤ 2 s after ESP32 polls cloud) | STM32 must respond within 5 s |

---

## Open items (hardware-team decision required)

1. **RAM budget** — Is newline-delimited JSON acceptable on STM32F103C8 (20 KB RAM)? A single TELEMETRY frame is ≈150 bytes. The ESP32 allocates 512-byte `JsonDocument` for parsing. If RAM is tight, a compact binary format can be substituted without changing any backend or PWA code — only this document and the firmware change.
2. **Telemetry on change vs on poll** — Currently the ESP32 polls every 5 s. The STM32 could instead push frames autonomously when state changes (pump on/off, fault, level threshold). This would reduce UART traffic but requires the ESP32 loop to handle unsolicited frames.
3. **Fault code strings** — The codes in the table above are proposals. Confirm or revise them. They must match the `Fault` union in `types/device.ts` exactly (case-sensitive).
