/**
 * aquaguard_protocol.h
 * ====================
 * AquaGuard STM32 — UART Protocol Layer (public interface)
 *
 * All protocol state (device mode, pump state, faults, sequence counter,
 * auto-control thresholds) lives in this module. The main loop calls
 * AQ_Protocol_Tick() once per iteration; it does not need to know what
 * frame was received.
 *
 * Wire format: newline-delimited JSON at 115200 8N1.
 * Protocol version: 1 (field "v" in every frame).
 *
 * Frames handled (ESP32 → STM32):
 *   {"v":1,"type":"PING"}
 *   {"v":1,"type":"REQUEST_TELEMETRY"}
 *   {"v":1,"cmdId":"<uuid>","type":"PUMP_ON"|"PUMP_OFF"|...}
 *
 * Frames emitted (STM32 → ESP32):
 *   {"v":1,"type":"PONG"}
 *   {"v":1,"seq":<n>,"waterLevel":<n>,...,"fault":null}
 *   {"v":1,"cmdId":"<uuid>","result":"EXECUTED"|"REJECTED"|"FAILED","reason":null|"<str>"}
 */

#ifndef AQUAGUARD_PROTOCOL_H
#define AQUAGUARD_PROTOCOL_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── Voltage thresholds (V AC RMS) ─────────────────────────────────────── */
/* Derived from the AquaGuard simulator (lib/simulator/simulator.ts).       */
/* Hardware team must confirm before production.                            */
#define AQ_VOLTAGE_UNDER_V    200.0f   /* below this  → UNDER_VOLTAGE fault  */
#define AQ_VOLTAGE_OVER_V     260.0f   /* above this  → OVER_VOLTAGE  fault  */

/* ── Water level thresholds (%) ─────────────────────────────────────────── */
#define AQ_LEVEL_AUTO_START   20       /* AUTO mode: start pump at or below  */
#define AQ_LEVEL_AUTO_STOP    95       /* AUTO mode: stop  pump at or above  */
#define AQ_LEVEL_TANK_FULL    100      /* refuse PUMP_ON when at/above this  */

/* ── UART line buffer ───────────────────────────────────────────────────── */
/* Max bytes in one JSON line. A TELEMETRY frame is ~150 bytes; a COMMAND   */
/* frame with a UUID cmdId is ~70 bytes. 256 bytes is sufficient with margin.*/
#define AQ_LINE_BUF_SIZE      256

/* ── Operating mode ─────────────────────────────────────────────────────── */
typedef enum {
    AQ_MODE_AUTO   = 0,
    AQ_MODE_MANUAL = 1
} AQ_Mode;

/* ── Fault codes (must match types/device.ts Fault union exactly) ───────── */
typedef enum {
    AQ_FAULT_NONE                    = 0,
    AQ_FAULT_DRY_RUN                 = 1,
    AQ_FAULT_UNDER_VOLTAGE           = 2,
    AQ_FAULT_OVER_VOLTAGE            = 3,
    AQ_FAULT_WATER_LEVEL_SENSOR      = 4,
    AQ_FAULT_VOLTAGE_SENSOR          = 5,
    AQ_FAULT_FLOW_SENSOR             = 6,
    AQ_FAULT_STM32_COMM_FAILURE      = 7
} AQ_Fault;

/* ── Protocol state (read-only snapshot for diagnostics) ────────────────── */
typedef struct {
    AQ_Mode  mode;
    bool     pumpOn;
    bool     dryRun;
    AQ_Fault fault;
    int      waterLevel;   /* 0–100 % */
    float    voltage;      /* V AC RMS */
    uint32_t sequence;     /* monotonic telemetry counter */
} AQ_State;

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Initialise protocol state. Call once before the main loop.
 * Does NOT initialise hardware — call HAL_Sys_Init() first.
 */
void AQ_Protocol_Init(void);

/**
 * Main loop tick. Call as frequently as possible (no blocking inside).
 *
 *   1. Reads all available bytes from UART into the line buffer.
 *   2. When a complete '\n'-terminated line is assembled, dispatches it.
 *   3. Updates sensors and AUTO mode logic on a 200 ms cadence.
 *   4. Enforces safety: stops pump if any fault becomes active.
 *
 * Returns the current protocol state snapshot (useful for diagnostics
 * on a debug UART; not required by the main loop).
 */
AQ_State AQ_Protocol_Tick(void);

/**
 * Return a read-only snapshot of the current protocol state.
 * Safe to call at any time.
 */
AQ_State AQ_Protocol_GetState(void);

#ifdef __cplusplus
}
#endif

#endif /* AQUAGUARD_PROTOCOL_H */
