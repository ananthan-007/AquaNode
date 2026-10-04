/**
 * test_protocol.c
 * ===============
 * Host-side unit tests for aquaguard_protocol.c
 *
 * Compiled with the stub HAL (aquaguard_hal_stub.c) on the developer's PC.
 * No real STM32 hardware required.
 *
 * Build:
 *   gcc -DAQUAGUARD_HAL_STUB -std=c99 -Wall -Wextra \
 *       aquaguard_protocol.c aquaguard_hal_stub.c test_protocol.c \
 *       -o test_protocol && ./test_protocol
 *
 * (see Makefile for the convenience target: make test)
 *
 * Every test calls ASSERT() which prints the failing location and exits 1.
 * On success prints "ALL TESTS PASSED" and exits 0.
 */

#ifdef AQUAGUARD_HAL_STUB

#include "aquaguard_protocol.h"
#include "aquaguard_hal.h"
#include "aquaguard_hal_stub.c"  /* inline stub implementations */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>

/* ─── Test infrastructure ──────────────────────────────────────────────── */

static int tests_run    = 0;
static int tests_passed = 0;

#define ASSERT(cond)  do {                                                    \
    tests_run++;                                                              \
    if (!(cond)) {                                                            \
        fprintf(stderr, "FAIL  %s  line %d: %s\n", __FILE__, __LINE__, #cond);\
        exit(1);                                                              \
    }                                                                         \
    tests_passed++;                                                           \
} while (0)

/* Push a JSON line into the stub RX buffer and run one tick to process it. */
static void send_line(const char *json_line) {
    stub_uart_push_rx(json_line);
    stub_uart_push_rx("\n");
    AQ_Protocol_Tick();
}

/* Shortcut: reset everything to clean state before each test group. */
static void reset_all(void) {
    HAL_UART_ESP32_Init();   /* clears TX/RX buffers */
    stub_uart_clear_tx();

    /* Reset stub sensor values to healthy defaults. */
    stub_water_level   = 65;
    stub_voltage       = 230.0f;
    stub_water_fault   = false;
    stub_voltage_fault = false;
    stub_flow_none     = false;
    stub_flow_fault    = false;
    stub_relay_on      = false;
    stub_tick_ms       = 0;

    AQ_Protocol_Init();
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

static int tx_contains(const char *substr) {
    return strstr(stub_uart_get_tx(), substr) != NULL;
}

/* =========================================================================
 * Test groups
 * ========================================================================= */

/* ── 1. PING / PONG ─────────────────────────────────────────────────────── */
static void test_ping_pong(void) {
    reset_all();

    send_line("{\"v\":1,\"type\":\"PING\"}");
    ASSERT(tx_contains("\"type\":\"PONG\""));
    ASSERT(tx_contains("\"v\":1"));
}

static void test_ping_pong_no_extra_fields(void) {
    reset_all();
    send_line("{\"v\":1,\"type\":\"PING\"}");
    /* PONG must not contain cmdId, seq, or fault */
    ASSERT(!tx_contains("cmdId"));
    ASSERT(!tx_contains("seq"));
    ASSERT(!tx_contains("fault"));
}

/* ── 2. REQUEST_TELEMETRY ───────────────────────────────────────────────── */
static void test_telemetry_fields_present(void) {
    reset_all();
    stub_water_level = 65;
    stub_voltage     = 230.0f;

    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");

    ASSERT(tx_contains("\"v\":1"));
    ASSERT(tx_contains("\"seq\""));
    ASSERT(tx_contains("\"waterLevel\""));
    ASSERT(tx_contains("\"voltage\""));
    ASSERT(tx_contains("\"voltageState\""));
    ASSERT(tx_contains("\"pumpState\""));
    ASSERT(tx_contains("\"mode\""));
    ASSERT(tx_contains("\"dryRun\""));
    ASSERT(tx_contains("\"fault\""));
}

static void test_telemetry_no_fault(void) {
    reset_all();
    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    /* When no fault, fault must be JSON null — not "null", not "" */
    ASSERT(tx_contains("\"fault\":null"));
    ASSERT(!tx_contains("\"fault\":\"null\""));
    ASSERT(!tx_contains("\"fault\":\"\""));
}

static void test_telemetry_fault_active(void) {
    reset_all();
    stub_voltage = 150.0f;  /* triggers UNDER_VOLTAGE */
    /* Run a sensor poll tick */
    stub_tick_ms = 300; /* past SENSOR_POLL_INTERVAL_MS */
    AQ_Protocol_Tick();
    stub_uart_clear_tx();

    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    ASSERT(tx_contains("\"fault\":\"UNDER_VOLTAGE\""));
    ASSERT(!tx_contains("\"fault\":null"));
}

static void test_telemetry_seq_increments(void) {
    reset_all();
    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    ASSERT(tx_contains("\"seq\":1"));   /* first request → seq 1 */
    stub_uart_clear_tx();

    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    ASSERT(tx_contains("\"seq\":2"));   /* second request → seq 2 */
}

static void test_telemetry_pump_state_off(void) {
    reset_all();
    stub_relay_on = false;
    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    ASSERT(tx_contains("\"pumpState\":\"OFF\""));
}

static void test_telemetry_pump_state_on(void) {
    reset_all();
    stub_relay_on = true;
    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    ASSERT(tx_contains("\"pumpState\":\"ON\""));
}

static void test_telemetry_voltage_state_normal(void) {
    reset_all();
    stub_voltage = 230.0f;
    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    ASSERT(tx_contains("\"voltageState\":\"NORMAL\""));
}

static void test_telemetry_voltage_state_under(void) {
    reset_all();
    stub_voltage = 190.0f;
    stub_tick_ms = 300;
    AQ_Protocol_Tick();
    stub_uart_clear_tx();
    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    ASSERT(tx_contains("\"voltageState\":\"UNDER_VOLTAGE\""));
}

static void test_telemetry_voltage_state_over(void) {
    reset_all();
    stub_voltage = 270.0f;
    stub_tick_ms = 300;
    AQ_Protocol_Tick();
    stub_uart_clear_tx();
    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    ASSERT(tx_contains("\"voltageState\":\"OVER_VOLTAGE\""));
}

static void test_telemetry_dry_run_flag(void) {
    reset_all();
    stub_relay_on  = true;
    stub_flow_none = true;  /* pump ON + no flow → dry run */
    stub_tick_ms   = 300;
    AQ_Protocol_Tick();
    stub_uart_clear_tx();
    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    ASSERT(tx_contains("\"dryRun\":true"));
    ASSERT(tx_contains("\"fault\":\"DRY_RUN\""));
}

/* ── 3. PUMP_ON command ─────────────────────────────────────────────────── */
static void test_pump_on_executed_manual_healthy(void) {
    reset_all();
    /* Switch to manual first */
    send_line("{\"v\":1,\"cmdId\":\"cmd-001\",\"type\":\"SET_MODE_MANUAL\"}");
    stub_uart_clear_tx();

    stub_water_level = 50;
    stub_voltage     = 230.0f;

    send_line("{\"v\":1,\"cmdId\":\"cmd-002\",\"type\":\"PUMP_ON\"}");
    ASSERT(tx_contains("\"result\":\"EXECUTED\""));
    ASSERT(tx_contains("\"cmdId\":\"cmd-002\""));
    ASSERT(tx_contains("\"reason\":null"));
    ASSERT(stub_relay_on == true);
}

static void test_pump_on_rejected_auto_mode(void) {
    reset_all();  /* default mode is AUTO */
    send_line("{\"v\":1,\"cmdId\":\"cmd-003\",\"type\":\"PUMP_ON\"}");
    ASSERT(tx_contains("\"result\":\"REJECTED\""));
    ASSERT(tx_contains("WRONG_MODE"));
    ASSERT(stub_relay_on == false);
}

static void test_pump_on_rejected_under_voltage(void) {
    reset_all();
    send_line("{\"v\":1,\"cmdId\":\"x\",\"type\":\"SET_MODE_MANUAL\"}");
    stub_uart_clear_tx();

    stub_voltage = 190.0f;
    stub_tick_ms = 300;
    AQ_Protocol_Tick();
    stub_uart_clear_tx();

    send_line("{\"v\":1,\"cmdId\":\"cmd-004\",\"type\":\"PUMP_ON\"}");
    ASSERT(tx_contains("\"result\":\"REJECTED\""));
    ASSERT(tx_contains("UNDER_VOLTAGE"));
    ASSERT(stub_relay_on == false);
}

static void test_pump_on_rejected_over_voltage(void) {
    reset_all();
    send_line("{\"v\":1,\"cmdId\":\"x\",\"type\":\"SET_MODE_MANUAL\"}");
    stub_uart_clear_tx();

    stub_voltage = 270.0f;
    stub_tick_ms = 300;
    AQ_Protocol_Tick();
    stub_uart_clear_tx();

    send_line("{\"v\":1,\"cmdId\":\"cmd-005\",\"type\":\"PUMP_ON\"}");
    ASSERT(tx_contains("\"result\":\"REJECTED\""));
    ASSERT(tx_contains("OVER_VOLTAGE"));
    ASSERT(stub_relay_on == false);
}

static void test_pump_on_rejected_tank_full(void) {
    reset_all();
    send_line("{\"v\":1,\"cmdId\":\"x\",\"type\":\"SET_MODE_MANUAL\"}");
    stub_uart_clear_tx();

    stub_water_level = 100;

    send_line("{\"v\":1,\"cmdId\":\"cmd-006\",\"type\":\"PUMP_ON\"}");
    ASSERT(tx_contains("\"result\":\"REJECTED\""));
    ASSERT(tx_contains("TANK_FULL"));
    ASSERT(stub_relay_on == false);
}

static void test_pump_on_rejected_active_fault(void) {
    reset_all();
    send_line("{\"v\":1,\"cmdId\":\"x\",\"type\":\"SET_MODE_MANUAL\"}");
    stub_uart_clear_tx();

    stub_water_fault = true;  /* water level sensor fault */
    stub_tick_ms = 300;
    AQ_Protocol_Tick();
    stub_uart_clear_tx();

    send_line("{\"v\":1,\"cmdId\":\"cmd-007\",\"type\":\"PUMP_ON\"}");
    ASSERT(tx_contains("\"result\":\"REJECTED\""));
    ASSERT(stub_relay_on == false);
}

/* ── 4. PUMP_OFF command ────────────────────────────────────────────────── */
static void test_pump_off_always_executes(void) {
    reset_all();
    stub_relay_on = true;
    send_line("{\"v\":1,\"cmdId\":\"cmd-008\",\"type\":\"PUMP_OFF\"}");
    ASSERT(tx_contains("\"result\":\"EXECUTED\""));
    ASSERT(stub_relay_on == false);
}

static void test_pump_off_works_with_fault(void) {
    reset_all();
    stub_relay_on = true;
    stub_voltage  = 150.0f; /* under-voltage fault */
    stub_tick_ms  = 300;
    AQ_Protocol_Tick();
    stub_uart_clear_tx();

    /* PUMP_OFF must always succeed regardless of fault state */
    send_line("{\"v\":1,\"cmdId\":\"cmd-009\",\"type\":\"PUMP_OFF\"}");
    ASSERT(tx_contains("\"result\":\"EXECUTED\""));
    ASSERT(stub_relay_on == false);
}

/* ── 5. Mode switching ──────────────────────────────────────────────────── */
static void test_set_mode_auto(void) {
    reset_all();
    /* Start in manual */
    send_line("{\"v\":1,\"cmdId\":\"x\",\"type\":\"SET_MODE_MANUAL\"}");
    stub_uart_clear_tx();

    send_line("{\"v\":1,\"cmdId\":\"cmd-010\",\"type\":\"SET_MODE_AUTO\"}");
    ASSERT(tx_contains("\"result\":\"EXECUTED\""));

    AQ_State st = AQ_Protocol_GetState();
    ASSERT(st.mode == AQ_MODE_AUTO);
}

static void test_set_mode_manual(void) {
    reset_all();  /* default is AUTO */
    send_line("{\"v\":1,\"cmdId\":\"cmd-011\",\"type\":\"SET_MODE_MANUAL\"}");
    ASSERT(tx_contains("\"result\":\"EXECUTED\""));

    AQ_State st = AQ_Protocol_GetState();
    ASSERT(st.mode == AQ_MODE_MANUAL);
}

/* ── 6. FAULT_RESET ─────────────────────────────────────────────────────── */
static void test_fault_reset_succeeds_when_clear(void) {
    reset_all();
    /* No fault active — reset succeeds */
    send_line("{\"v\":1,\"cmdId\":\"cmd-012\",\"type\":\"FAULT_RESET\"}");
    ASSERT(tx_contains("\"result\":\"EXECUTED\""));
}

static void test_fault_reset_rejected_when_fault_persists(void) {
    reset_all();
    stub_voltage = 150.0f;
    stub_tick_ms = 300;
    AQ_Protocol_Tick();
    stub_uart_clear_tx();

    send_line("{\"v\":1,\"cmdId\":\"cmd-013\",\"type\":\"FAULT_RESET\"}");
    ASSERT(tx_contains("\"result\":\"REJECTED\""));
    ASSERT(tx_contains("still active"));
}

/* ── 7. REQUEST_LEVEL ───────────────────────────────────────────────────── */
static void test_request_level_executes_and_sends_telemetry(void) {
    reset_all();
    stub_water_level = 42;
    send_line("{\"v\":1,\"cmdId\":\"cmd-014\",\"type\":\"REQUEST_LEVEL\"}");
    /* Should get EXECUTED result AND a telemetry frame */
    ASSERT(tx_contains("\"result\":\"EXECUTED\""));
    ASSERT(tx_contains("\"waterLevel\""));
    ASSERT(tx_contains("42"));
}

/* ── 8. Unknown command ─────────────────────────────────────────────────── */
static void test_unknown_command_fails(void) {
    reset_all();
    send_line("{\"v\":1,\"cmdId\":\"cmd-015\",\"type\":\"SELF_DESTRUCT\"}");
    ASSERT(tx_contains("\"result\":\"FAILED\""));
    ASSERT(tx_contains("unknown command"));
}

/* ── 9. Wrong protocol version ──────────────────────────────────────────── */
static void test_wrong_version_ignored(void) {
    reset_all();
    send_line("{\"v\":2,\"type\":\"PING\"}");
    /* v:2 must be silently ignored — no PONG */
    ASSERT(!tx_contains("PONG"));
}

/* ── 10. Safety: pump auto-stops on fault ───────────────────────────────── */
static void test_safety_pump_stops_on_fault(void) {
    reset_all();
    stub_relay_on = true;  /* pump was on */
    stub_voltage  = 150.0f; /* fault condition */
    stub_tick_ms  = 300;

    AQ_Protocol_Tick();  /* sensor poll runs, detects fault, stops pump */

    ASSERT(stub_relay_on == false);
}

/* ── 11. AUTO mode: auto-start ──────────────────────────────────────────── */
static void test_auto_mode_starts_pump_low_water(void) {
    reset_all();
    /* Default mode is AUTO */
    stub_water_level = 15;  /* below AQ_LEVEL_AUTO_START (20) */
    stub_voltage     = 230.0f;
    stub_tick_ms     = 300;

    AQ_Protocol_Tick();

    ASSERT(stub_relay_on == true);
}

/* ── 12. AUTO mode: auto-stop ───────────────────────────────────────────── */
static void test_auto_mode_stops_pump_high_water(void) {
    reset_all();
    stub_relay_on    = true;
    stub_water_level = 97;  /* above AQ_LEVEL_AUTO_STOP (95) */
    stub_tick_ms     = 300;

    AQ_Protocol_Tick();

    ASSERT(stub_relay_on == false);
}

/* ── 13. AUTO mode does not start pump with fault ───────────────────────── */
static void test_auto_mode_no_start_with_fault(void) {
    reset_all();
    stub_water_level = 10;   /* would trigger auto-start */
    stub_voltage     = 150.0f; /* but voltage fault present */
    stub_tick_ms     = 300;

    AQ_Protocol_Tick();

    ASSERT(stub_relay_on == false);
}

/* ── 14. cmdId is echoed correctly ──────────────────────────────────────── */
static void test_cmdid_echoed_in_result(void) {
    reset_all();
    send_line("{\"v\":1,\"cmdId\":\"deadbeef-1234-5678\",\"type\":\"PUMP_OFF\"}");
    ASSERT(tx_contains("\"cmdId\":\"deadbeef-1234-5678\""));
}

/* ── 15. Line buffer overflow protection ────────────────────────────────── */
static void test_line_overflow_no_crash(void) {
    reset_all();
    /* Push 300 bytes without a newline — should discard without crashing. */
    char big[300];
    memset(big, 'A', sizeof(big));
    stub_uart_push_rx(big);
    AQ_Protocol_Tick(); /* must not crash or corrupt state */

    /* After overflow, normal frames must still work. */
    send_line("{\"v\":1,\"type\":\"PING\"}");
    ASSERT(tx_contains("PONG"));
}

/* ── 16. Water level sensor fault in telemetry ──────────────────────────── */
static void test_water_level_sensor_fault(void) {
    reset_all();
    stub_water_fault = true;
    stub_tick_ms     = 300;
    AQ_Protocol_Tick();
    stub_uart_clear_tx();

    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    ASSERT(tx_contains("\"fault\":\"WATER_LEVEL_SENSOR_FAULT\""));
}

/* ── 17. Flow sensor fault in telemetry ─────────────────────────────────── */
static void test_flow_sensor_fault(void) {
    reset_all();
    stub_flow_fault = true;
    stub_tick_ms    = 300;
    AQ_Protocol_Tick();
    stub_uart_clear_tx();

    send_line("{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}");
    ASSERT(tx_contains("\"fault\":\"FLOW_SENSOR_FAULT\""));
}

/* =========================================================================
 * Main
 * ========================================================================= */

int main(void) {
    printf("AquaGuard STM32 Protocol Tests\n");
    printf("================================\n");

    test_ping_pong();
    test_ping_pong_no_extra_fields();

    test_telemetry_fields_present();
    test_telemetry_no_fault();
    test_telemetry_fault_active();
    test_telemetry_seq_increments();
    test_telemetry_pump_state_off();
    test_telemetry_pump_state_on();
    test_telemetry_voltage_state_normal();
    test_telemetry_voltage_state_under();
    test_telemetry_voltage_state_over();
    test_telemetry_dry_run_flag();

    test_pump_on_executed_manual_healthy();
    test_pump_on_rejected_auto_mode();
    test_pump_on_rejected_under_voltage();
    test_pump_on_rejected_over_voltage();
    test_pump_on_rejected_tank_full();
    test_pump_on_rejected_active_fault();

    test_pump_off_always_executes();
    test_pump_off_works_with_fault();

    test_set_mode_auto();
    test_set_mode_manual();

    test_fault_reset_succeeds_when_clear();
    test_fault_reset_rejected_when_fault_persists();

    test_request_level_executes_and_sends_telemetry();
    test_unknown_command_fails();
    test_wrong_version_ignored();

    test_safety_pump_stops_on_fault();
    test_auto_mode_starts_pump_low_water();
    test_auto_mode_stops_pump_high_water();
    test_auto_mode_no_start_with_fault();

    test_cmdid_echoed_in_result();
    test_line_overflow_no_crash();
    test_water_level_sensor_fault();
    test_flow_sensor_fault();

    printf("\n%d / %d tests passed\n", tests_passed, tests_run);
    if (tests_passed == tests_run) {
        printf("ALL TESTS PASSED\n");
        return 0;
    }
    return 1;
}

#else
/* Prevent linking this file without AQUAGUARD_HAL_STUB */
int main(void) { return 0; }
#endif /* AQUAGUARD_HAL_STUB */
