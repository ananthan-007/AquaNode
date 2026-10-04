/**
 * aquaguard_protocol.c
 * ====================
 * AquaGuard STM32 — UART Protocol Implementation
 *
 * Implements newline-delimited JSON protocol v1 between the STM32 and the
 * ESP32 gateway. Only talks to hardware via aquaguard_hal.h — no direct
 * register access or HAL calls here.
 *
 * Memory note: targeting STM32F103C8 with 20 KB RAM.
 *   - Line buffer:    256 bytes (static)
 *   - cmdId buffer:    64 bytes (static, UUIDs are 36 chars + null)
 *   - JSON output:    256 bytes (stack, per transmit call)
 *   - Total overhead: ~600 bytes — well within budget.
 *
 * This file does NOT contain:
 *   - Any STM32 HAL/LL includes
 *   - Any peripheral register access
 *   - Any CMSIS headers
 *   - Any toolchain-specific pragmas
 *
 * All hardware access goes through aquaguard_hal.h.
 */

#include "aquaguard_protocol.h"
#include "aquaguard_hal.h"

#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>

/* =========================================================================
 * Internal state
 * ========================================================================= */

/* Monotonic telemetry sequence counter. Wraps at INT32_MAX (~2.1 billion). */
static uint32_t s_sequence = 0;

/* Operating mode: AUTO or MANUAL. Default: AUTO. */
static AQ_Mode  s_mode = AQ_MODE_AUTO;

/* True when a voltage/level/sensor fault is latched. */
static AQ_Fault s_fault = AQ_FAULT_NONE;

/* Latched dry-run flag (pump was ON, no flow detected). */
static bool s_dry_run = false;

/* Timestamp of last sensor/auto poll (ms). */
static uint32_t s_last_sensor_poll_ms = 0;

/* Sensor poll interval (ms). 200 ms gives good responsiveness without      */
/* hammering the ADC; adjust if the sensor needs more settling time.        */
#define SENSOR_POLL_INTERVAL_MS  200U

/* ── UART line buffer ──────────────────────────────────────────────────── */
static char     s_line_buf[AQ_LINE_BUF_SIZE];
static uint16_t s_line_len = 0;

/* ── Last received cmdId (UUID, up to 36 chars + null) ─────────────────── */
#define CMD_ID_MAX 64
static char s_pending_cmd_id[CMD_ID_MAX];

/* =========================================================================
 * Forward declarations
 * ========================================================================= */

static void     dispatch_line(const char *line);
static void     handle_ping(void);
static void     handle_request_telemetry(void);
static void     handle_command(const char *line);

static void     send_pong(void);
static void     send_telemetry(void);
static void     send_command_result(const char *cmd_id,
                                    const char *result,
                                    const char *reason);

static void     update_sensors(void);
static void     enforce_safety(void);
static void     auto_control(int water_level);

static const char *fault_string(AQ_Fault f);
static const char *voltage_state_string(float v);

/* Minimal JSON key extraction — no dynamic allocation. */
static bool     json_get_string(const char *json, const char *key,
                                char *out, size_t out_size);

/* =========================================================================
 * Public API
 * ========================================================================= */

void AQ_Protocol_Init(void) {
    s_sequence          = 0;
    s_mode              = AQ_MODE_AUTO;
    s_fault             = AQ_FAULT_NONE;
    s_dry_run           = false;
    s_line_len          = 0;
    s_last_sensor_poll_ms = HAL_Sys_GetTickMs();
    memset(s_line_buf,       0, sizeof(s_line_buf));
    memset(s_pending_cmd_id, 0, sizeof(s_pending_cmd_id));

    HAL_UART_ESP32_Init();
}

AQ_State AQ_Protocol_Tick(void) {
    /* ── 1. Read UART bytes into line buffer ─────────────────────────── */
    int byte;
    while ((byte = HAL_UART_ESP32_ReceiveByte()) >= 0) {
        char c = (char)byte;

        if (c == '\n' || c == '\r') {
            /* Line complete — dispatch if non-empty. */
            if (s_line_len > 0) {
                s_line_buf[s_line_len] = '\0';
                dispatch_line(s_line_buf);
                s_line_len = 0;
            }
        } else {
            /* Accumulate byte, guarding against overflow. */
            if (s_line_len < AQ_LINE_BUF_SIZE - 1) {
                s_line_buf[s_line_len++] = c;
            } else {
                /* Line too long — discard and reset. */
                s_line_len = 0;
            }
        }
    }

    /* ── 2. Periodic sensor update and safety enforcement ────────────── */
    uint32_t now = HAL_Sys_GetTickMs();
    if ((now - s_last_sensor_poll_ms) >= SENSOR_POLL_INTERVAL_MS) {
        s_last_sensor_poll_ms = now;
        update_sensors();
        enforce_safety();
        if (s_mode == AQ_MODE_AUTO) {
            auto_control(HAL_WaterLevel_ReadPercent());
        }
    }

    return AQ_Protocol_GetState();
}

AQ_State AQ_Protocol_GetState(void) {
    AQ_State st;
    st.mode       = s_mode;
    st.pumpOn     = HAL_Relay_IsOn();
    st.dryRun     = s_dry_run;
    st.fault      = s_fault;
    st.waterLevel = HAL_WaterLevel_ReadPercent();
    st.voltage    = HAL_Voltage_ReadVolts();
    st.sequence   = s_sequence;
    return st;
}

/* =========================================================================
 * Frame dispatch
 * ========================================================================= */

static void dispatch_line(const char *line) {
    /* Require "v":1 — silently drop frames with different version. */
    char ver_buf[8];
    if (!json_get_string(line, "\"v\"", ver_buf, sizeof(ver_buf))) return;
    if (ver_buf[0] != '1') return;

    /* Extract "type" field. */
    char type_buf[32];
    if (!json_get_string(line, "\"type\"", type_buf, sizeof(type_buf))) {
        /* No "type" field — might be a command (has "cmdId"). */
        handle_command(line);
        return;
    }

    if (strcmp(type_buf, "PING") == 0) {
        handle_ping();
    } else if (strcmp(type_buf, "REQUEST_TELEMETRY") == 0) {
        handle_request_telemetry();
    } else {
        /* Unknown type — treat as possible command frame. */
        handle_command(line);
    }
}

/* ── PING ─────────────────────────────────────────────────────────────── */

static void handle_ping(void) {
    send_pong();
}

/* ── REQUEST_TELEMETRY ────────────────────────────────────────────────── */

static void handle_request_telemetry(void) {
    /* Bump sequence on every outgoing telemetry frame. */
    if (s_sequence < 0x7FFFFFFF) {
        s_sequence++;
    } else {
        s_sequence = 0; /* wrap */
    }
    send_telemetry();
}

/* ── COMMAND ──────────────────────────────────────────────────────────── */

/*
 * ESP32 command frame:
 *   {"v":1,"cmdId":"<uuid>","type":"PUMP_ON"}
 *
 * The STM32 is the SAFETY AUTHORITY. Every command is validated before
 * execution. Rejections include the reason code expected by the PWA
 * (matching types/device.ts Fault strings and the UART_PROTOCOL.md table).
 */
static void handle_command(const char *line) {
    char cmd_id[CMD_ID_MAX];
    char cmd_type[32];

    if (!json_get_string(line, "\"cmdId\"", cmd_id, sizeof(cmd_id))) return;
    if (!json_get_string(line, "\"type\"",  cmd_type, sizeof(cmd_type))) {
        send_command_result(cmd_id, "FAILED", "missing type field");
        return;
    }

    /* Copy for use in subsequent send calls. */
    strncpy(s_pending_cmd_id, cmd_id, CMD_ID_MAX - 1);
    s_pending_cmd_id[CMD_ID_MAX - 1] = '\0';

    /* ── PUMP_ON ────────────────────────────────────────────────────── */
    if (strcmp(cmd_type, "PUMP_ON") == 0) {
        if (s_mode != AQ_MODE_MANUAL) {
            send_command_result(cmd_id, "REJECTED", "WRONG_MODE");
            return;
        }
        if (s_fault != AQ_FAULT_NONE) {
            send_command_result(cmd_id, "REJECTED", fault_string(s_fault));
            return;
        }
        int level = HAL_WaterLevel_ReadPercent();
        if (level >= AQ_LEVEL_TANK_FULL) {
            send_command_result(cmd_id, "REJECTED", "TANK_FULL");
            return;
        }
        float v = HAL_Voltage_ReadVolts();
        if (v < AQ_VOLTAGE_UNDER_V) {
            send_command_result(cmd_id, "REJECTED", "UNDER_VOLTAGE");
            return;
        }
        if (v > AQ_VOLTAGE_OVER_V) {
            send_command_result(cmd_id, "REJECTED", "OVER_VOLTAGE");
            return;
        }
        HAL_Relay_PumpOn();
        s_dry_run = false; /* reset latched dry-run on new pump start */
        send_command_result(cmd_id, "EXECUTED", NULL);
        return;
    }

    /* ── PUMP_OFF ───────────────────────────────────────────────────── */
    if (strcmp(cmd_type, "PUMP_OFF") == 0) {
        HAL_Relay_PumpOff();
        send_command_result(cmd_id, "EXECUTED", NULL);
        return;
    }

    /* ── SET_MODE_AUTO ──────────────────────────────────────────────── */
    if (strcmp(cmd_type, "SET_MODE_AUTO") == 0) {
        s_mode = AQ_MODE_AUTO;
        send_command_result(cmd_id, "EXECUTED", NULL);
        return;
    }

    /* ── SET_MODE_MANUAL ────────────────────────────────────────────── */
    if (strcmp(cmd_type, "SET_MODE_MANUAL") == 0) {
        s_mode = AQ_MODE_MANUAL;
        send_command_result(cmd_id, "EXECUTED", NULL);
        return;
    }

    /* ── FAULT_RESET ────────────────────────────────────────────────── */
    if (strcmp(cmd_type, "FAULT_RESET") == 0) {
        /*
         * Only clear the latch if the underlying hardware condition has
         * actually cleared. Re-read sensors to check.
         */
        update_sensors(); /* refresh fault detection */
        if (s_fault != AQ_FAULT_NONE) {
            /* Underlying fault still present — cannot reset. */
            char reason[48];
            snprintf(reason, sizeof(reason), "Cannot reset: %s still active",
                     fault_string(s_fault));
            send_command_result(cmd_id, "REJECTED", reason);
            return;
        }
        /* Fault cleared — also clear dry-run latch. */
        s_dry_run = false;
        send_command_result(cmd_id, "EXECUTED", NULL);
        return;
    }

    /* ── REQUEST_LEVEL ──────────────────────────────────────────────── */
    if (strcmp(cmd_type, "REQUEST_LEVEL") == 0) {
        /*
         * Respond with EXECUTED, then immediately send a telemetry frame
         * so the ESP32 gets the current level right away.
         */
        send_command_result(cmd_id, "EXECUTED", NULL);
        handle_request_telemetry();
        return;
    }

    /* ── Unknown command ────────────────────────────────────────────── */
    send_command_result(cmd_id, "FAILED", "unknown command type");
}

/* =========================================================================
 * Frame serialisation
 *
 * Uses snprintf into a 256-byte stack buffer — safe on STM32F103C8 at the
 * call depths here (never more than 2 levels deep from Tick).
 * ========================================================================= */

static void send_pong(void) {
    /* {"v":1,"type":"PONG"}\n */
    HAL_UART_ESP32_Transmit("{\"v\":1,\"type\":\"PONG\"}\n");
}

static void send_telemetry(void) {
    int   level      = HAL_WaterLevel_ReadPercent();
    float volts      = HAL_Voltage_ReadVolts();
    bool  pump_on    = HAL_Relay_IsOn();
    const char *pump_str    = pump_on          ? "ON"     : "OFF";
    const char *mode_str    = (s_mode == AQ_MODE_AUTO) ? "AUTO" : "MANUAL";
    const char *vstate_str  = voltage_state_string(volts);
    const char *fault_str;

    if (s_fault == AQ_FAULT_NONE) {
        fault_str = "null"; /* JSON null, not a string */
    } else {
        fault_str = NULL;   /* handled below with quotes */
    }

    char buf[256];

    if (fault_str != NULL) {
        /* No fault — emit JSON null without quotes. */
        snprintf(buf, sizeof(buf),
            "{\"v\":1,\"seq\":%lu"
            ",\"waterLevel\":%d"
            ",\"voltage\":%.1f"
            ",\"voltageState\":\"%s\""
            ",\"pumpState\":\"%s\""
            ",\"mode\":\"%s\""
            ",\"dryRun\":%s"
            ",\"fault\":null}\n",
            (unsigned long)s_sequence,
            level,
            (double)volts,
            vstate_str,
            pump_str,
            mode_str,
            s_dry_run ? "true" : "false");
    } else {
        /* Fault active — emit quoted string. */
        snprintf(buf, sizeof(buf),
            "{\"v\":1,\"seq\":%lu"
            ",\"waterLevel\":%d"
            ",\"voltage\":%.1f"
            ",\"voltageState\":\"%s\""
            ",\"pumpState\":\"%s\""
            ",\"mode\":\"%s\""
            ",\"dryRun\":%s"
            ",\"fault\":\"%s\"}\n",
            (unsigned long)s_sequence,
            level,
            (double)volts,
            vstate_str,
            pump_str,
            mode_str,
            s_dry_run ? "true" : "false",
            fault_string(s_fault));
    }

    HAL_UART_ESP32_Transmit(buf);
}

static void send_command_result(const char *cmd_id,
                                const char *result,
                                const char *reason) {
    char buf[256];
    if (reason == NULL || reason[0] == '\0') {
        snprintf(buf, sizeof(buf),
            "{\"v\":1,\"cmdId\":\"%s\",\"result\":\"%s\",\"reason\":null}\n",
            cmd_id, result);
    } else {
        snprintf(buf, sizeof(buf),
            "{\"v\":1,\"cmdId\":\"%s\",\"result\":\"%s\",\"reason\":\"%s\"}\n",
            cmd_id, result, reason);
    }
    HAL_UART_ESP32_Transmit(buf);
}

/* =========================================================================
 * Sensor update and safety logic
 * ========================================================================= */

static void update_sensors(void) {
    /*
     * Fault detection priority (matches simulator.ts getActiveFault()):
     *   1. Water level sensor fault
     *   2. Voltage sensor fault
     *   3. Flow sensor fault
     *   4. Under-voltage / over-voltage (from voltage reading)
     *   5. Dry-run (pump ON + no flow)
     *
     * STM32_COMM_FAILURE is not self-reported here — it is reported by the
     * cloud/PWA when the ESP32 loses UART contact with us.
     */

    if (HAL_WaterLevel_IsFault()) {
        s_fault = AQ_FAULT_WATER_LEVEL_SENSOR;
        return;
    }

    if (HAL_Voltage_IsFault()) {
        s_fault = AQ_FAULT_VOLTAGE_SENSOR;
        return;
    }

    if (HAL_Flow_IsFault()) {
        s_fault = AQ_FAULT_FLOW_SENSOR;
        return;
    }

    float v = HAL_Voltage_ReadVolts();
    if (v < AQ_VOLTAGE_UNDER_V) {
        s_fault = AQ_FAULT_UNDER_VOLTAGE;
        return;
    }
    if (v > AQ_VOLTAGE_OVER_V) {
        s_fault = AQ_FAULT_OVER_VOLTAGE;
        return;
    }

    /* Dry-run: pump is ON but no flow detected. */
    if (HAL_Relay_IsOn() && HAL_Flow_IsNone()) {
        s_dry_run = true;
        s_fault   = AQ_FAULT_DRY_RUN;
        return;
    }

    /* No fault conditions remain. */
    s_fault = AQ_FAULT_NONE;
}

static void enforce_safety(void) {
    /*
     * If any fault is active, stop the pump immediately.
     * This is the hardware safety authority rule — matches simulator.ts.
     */
    if (s_fault != AQ_FAULT_NONE && HAL_Relay_IsOn()) {
        HAL_Relay_PumpOff();
    }
}

static void auto_control(int water_level) {
    /*
     * AUTO mode: start pump when level falls to/below AQ_LEVEL_AUTO_START,
     * stop when level rises to/above AQ_LEVEL_AUTO_STOP.
     * Never operate in AUTO when a fault is active.
     */
    if (s_fault != AQ_FAULT_NONE) return;
    if (water_level < 0) return; /* sensor fault — already handled */

    if (!HAL_Relay_IsOn() && water_level <= AQ_LEVEL_AUTO_START) {
        float v = HAL_Voltage_ReadVolts();
        if (v >= AQ_VOLTAGE_UNDER_V && v <= AQ_VOLTAGE_OVER_V) {
            HAL_Relay_PumpOn();
        }
    } else if (HAL_Relay_IsOn() && water_level >= AQ_LEVEL_AUTO_STOP) {
        HAL_Relay_PumpOff();
    }
}

/* =========================================================================
 * Helpers
 * ========================================================================= */

static const char *fault_string(AQ_Fault f) {
    switch (f) {
        case AQ_FAULT_DRY_RUN:              return "DRY_RUN";
        case AQ_FAULT_UNDER_VOLTAGE:        return "UNDER_VOLTAGE";
        case AQ_FAULT_OVER_VOLTAGE:         return "OVER_VOLTAGE";
        case AQ_FAULT_WATER_LEVEL_SENSOR:   return "WATER_LEVEL_SENSOR_FAULT";
        case AQ_FAULT_VOLTAGE_SENSOR:       return "VOLTAGE_SENSOR_FAULT";
        case AQ_FAULT_FLOW_SENSOR:          return "FLOW_SENSOR_FAULT";
        case AQ_FAULT_STM32_COMM_FAILURE:   return "STM32_COMM_FAILURE";
        default:                            return "UNKNOWN_FAULT";
    }
}

static const char *voltage_state_string(float v) {
    if (v < AQ_VOLTAGE_UNDER_V) return "UNDER_VOLTAGE";
    if (v > AQ_VOLTAGE_OVER_V)  return "OVER_VOLTAGE";
    return "NORMAL";
}

/*
 * Minimal JSON string extractor.
 *
 * Finds the value of a JSON key (which must include its surrounding quotes,
 * e.g. "\"type\""). Works for string, number, and boolean values.
 * Handles both quoted strings (strips quotes) and unquoted values.
 *
 * Returns true if the key was found and the value fit in out_size.
 * Not a full JSON parser — sufficient for the fixed AquaGuard frame shapes.
 */
static bool json_get_string(const char *json,
                            const char *key,
                            char       *out,
                            size_t      out_size) {
    if (!json || !key || !out || out_size == 0) return false;

    const char *p = strstr(json, key);
    if (!p) return false;

    /* Move past the key. */
    p += strlen(key);

    /* Skip whitespace and colon. */
    while (*p == ' ' || *p == '\t') p++;
    if (*p != ':') return false;
    p++;
    while (*p == ' ' || *p == '\t') p++;

    if (*p == '"') {
        /* Quoted string value — extract content between quotes. */
        p++;
        size_t i = 0;
        while (*p && *p != '"' && i < out_size - 1) {
            out[i++] = *p++;
        }
        out[i] = '\0';
        return (*p == '"');
    } else {
        /* Unquoted value (number, boolean, null) — read until delimiter. */
        size_t i = 0;
        while (*p && *p != ',' && *p != '}' && *p != ']' &&
               *p != '\n' && *p != '\r' && *p != ' ' &&
               i < out_size - 1) {
            out[i++] = *p++;
        }
        out[i] = '\0';
        return (i > 0);
    }
}
