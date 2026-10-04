/**
 * aquaguard_hal_stub.c
 * ====================
 * Stub implementations of the Hardware Abstraction Layer.
 *
 * PURPOSE: Allow the protocol logic to compile and be unit-tested on any
 * host (including a PC running GCC) without real STM32 hardware. Every
 * function returns a safe, plausible value so the protocol state machine
 * can be exercised.
 *
 * DO NOT flash this file to real hardware. Replace it with
 * aquaguard_hal_stm32.c (your real HAL implementation) when the wiring
 * is confirmed.
 *
 * This file is intentionally compiled under the guard:
 *   #ifdef AQUAGUARD_HAL_STUB
 * so it cannot accidentally end up in a production build. Add
 *   -DAQUAGUARD_HAL_STUB
 * to your host test build flags only.
 */

#ifdef AQUAGUARD_HAL_STUB

#include "aquaguard_hal.h"
#include <stdio.h>
#include <string.h>

/* ── Stub UART state ────────────────────────────────────────────────────── */

/* Input ring buffer: tests write bytes here; ReceiveByte reads from here. */
#define STUB_RX_BUF_SIZE 512
static char  stub_rx_buf[STUB_RX_BUF_SIZE];
static int   stub_rx_head = 0;
static int   stub_rx_tail = 0;

/* Output accumulator: tests read what was transmitted. */
#define STUB_TX_BUF_SIZE 2048
static char  stub_tx_buf[STUB_TX_BUF_SIZE];
static int   stub_tx_len  = 0;

/* Push a string into the stub RX buffer (simulates ESP32 sending to STM32). */
void stub_uart_push_rx(const char *data) {
    while (*data) {
        stub_rx_buf[stub_rx_head] = *data++;
        stub_rx_head = (stub_rx_head + 1) % STUB_RX_BUF_SIZE;
    }
}

/* Read and clear accumulated TX output. */
const char *stub_uart_get_tx(void) { return stub_tx_buf; }
void        stub_uart_clear_tx(void) { stub_tx_len = 0; stub_tx_buf[0] = '\0'; }

/* ── Stub sensor state (tests can set these directly) ───────────────────── */
int   stub_water_level      = 65;   /* % */
float stub_voltage          = 230.0f;
bool  stub_water_fault      = false;
bool  stub_voltage_fault    = false;
bool  stub_flow_none        = false;
bool  stub_flow_fault       = false;
bool  stub_relay_on         = false;
uint32_t stub_tick_ms       = 0;

/* ── HAL implementations ────────────────────────────────────────────────── */

void HAL_Sys_Init(void) { /* nothing for stub */ }

void HAL_UART_ESP32_Init(void) {
    stub_rx_head = stub_rx_tail = 0;
    stub_tx_len  = 0;
    stub_tx_buf[0] = '\0';
}

void HAL_UART_ESP32_Transmit(const char *str) {
    int len = (int)strlen(str);
    if (stub_tx_len + len < STUB_TX_BUF_SIZE - 1) {
        memcpy(stub_tx_buf + stub_tx_len, str, len);
        stub_tx_len += len;
        stub_tx_buf[stub_tx_len] = '\0';
    }
}

int HAL_UART_ESP32_ReceiveByte(void) {
    if (stub_rx_head == stub_rx_tail) return -1;
    unsigned char c = (unsigned char)stub_rx_buf[stub_rx_tail];
    stub_rx_tail = (stub_rx_tail + 1) % STUB_RX_BUF_SIZE;
    return (int)c;
}

int   HAL_WaterLevel_ReadPercent(void) { return stub_water_level; }
bool  HAL_WaterLevel_IsFault(void)     { return stub_water_fault;  }

float HAL_Voltage_ReadVolts(void)      { return stub_voltage;       }
bool  HAL_Voltage_IsFault(void)        { return stub_voltage_fault; }

bool  HAL_Flow_IsNone(void)            { return stub_flow_none;  }
bool  HAL_Flow_IsFault(void)           { return stub_flow_fault; }

void  HAL_Relay_PumpOn(void)           { stub_relay_on = true;  }
void  HAL_Relay_PumpOff(void)          { stub_relay_on = false; }
bool  HAL_Relay_IsOn(void)             { return stub_relay_on;  }

uint32_t HAL_Sys_GetTickMs(void)       { return stub_tick_ms; }

#endif /* AQUAGUARD_HAL_STUB */
