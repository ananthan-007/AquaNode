/**
 * aquaguard_hal.h
 * ===============
 * Hardware Abstraction Layer — AquaGuard STM32 Firmware
 *
 * This header defines every hardware-specific operation the AquaGuard
 * protocol layer needs. ALL functions here are stubs that must be
 * implemented by the hardware team once physical wiring is confirmed.
 *
 * The protocol implementation in aquaguard_protocol.c / aquaguard_main.c
 * calls only the functions declared here — it never touches registers,
 * HAL calls, or peripheral handles directly.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  HARDWARE TEAM: implement every function in aquaguard_hal.c │
 * │  after confirming wiring and peripheral assignments.        │
 * └─────────────────────────────────────────────────────────────┘
 *
 * MCU: STM32F103C8 (Blue Pill) — 72 MHz Cortex-M3, 20 KB RAM, 64 KB Flash
 * (The only MCU reference in the repository is the 20 KB RAM note in
 * docs/UART_PROTOCOL.md. If a different STM32 variant is used, the RAM
 * budget note in aquaguard_protocol.c must be re-verified.)
 *
 * Toolchain: Any STM32 toolchain (STM32CubeIDE/HAL, Keil MDK, arm-none-eabi-gcc
 * with LL/HAL, or bare CMSIS). The C code here uses only C99 standard types and
 * no toolchain-specific extensions.
 */

#ifndef AQUAGUARD_HAL_H
#define AQUAGUARD_HAL_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * SECTION 1: UART (ESP32 communication)
 *
 * REQUIRES HARDWARE TEAM:
 *   - Which USART peripheral is wired to the ESP32?
 *     (ESP32 UART2: GPIO16=RX, GPIO17=TX)
 *     STM32 side: ??? USART1 (PA9/PA10)? USART2 (PA2/PA3)? USART3 (PB10/PB11)?
 *   - Confirm 115200 8N1, no hardware flow control.
 * ========================================================================= */

/**
 * Initialise the UART peripheral used for ESP32 communication.
 * Called once from main() before the main loop.
 * Baud: 115200, 8 data bits, no parity, 1 stop bit, no flow control.
 */
void HAL_UART_ESP32_Init(void);

/**
 * Transmit a null-terminated string over the ESP32 UART.
 * Must block until all bytes are sent (or DMA transfer is complete).
 * The protocol layer always appends '\n' itself — do not add it here.
 */
void HAL_UART_ESP32_Transmit(const char *str);

/**
 * Return the next byte from the ESP32 UART receive buffer, or -1 if empty.
 * Non-blocking — returns immediately if no data is available.
 * Called in a tight loop by the protocol layer to read one JSON line.
 */
int  HAL_UART_ESP32_ReceiveByte(void);

/* =========================================================================
 * SECTION 2: Water level sensor
 *
 * REQUIRES HARDWARE TEAM:
 *   - Sensor type: ultrasonic distance / capacitive float /
 *                  resistive chain / pressure transducer?
 *   - ADC channel number and GPIO pin.
 *   - Conversion formula: raw ADC counts → percentage 0–100.
 *   - Whether the sensor can fault (open/short circuit detection).
 * ========================================================================= */

/**
 * Read the current water level as a percentage 0–100.
 * Returns -1 if the sensor is faulted or reading is out of range.
 * Called every telemetry cycle.
 */
int HAL_WaterLevel_ReadPercent(void);

/**
 * Return true if the water level sensor is faulted (no valid reading).
 * Implementation should check ADC out-of-range, open circuit, etc.
 */
bool HAL_WaterLevel_IsFault(void);

/* =========================================================================
 * SECTION 3: Voltage measurement
 *
 * REQUIRES HARDWARE TEAM:
 *   - ADC channel and GPIO pin for the voltage divider/transducer output.
 *   - Scaling formula: raw ADC counts → volts (AC RMS).
 *   - Whether the sensor can fault.
 *   - Under-voltage threshold (simulator uses 200 V — confirm for real hardware).
 *   - Over-voltage threshold  (simulator uses 260 V — confirm for real hardware).
 * ========================================================================= */

/**
 * Read the current line voltage in volts (AC RMS).
 * Returns 0.0f if the sensor is faulted.
 */
float HAL_Voltage_ReadVolts(void);

/**
 * Return true if the voltage sensor is faulted.
 */
bool HAL_Voltage_IsFault(void);

/* =========================================================================
 * SECTION 4: Flow sensor (dry-run detection)
 *
 * REQUIRES HARDWARE TEAM:
 *   - Sensor type: hall-effect pulse counter / reed switch / differential
 *                  pressure?
 *   - GPIO pin (interrupt or polled).
 *   - Detection logic: what constitutes "no flow" while pump is running?
 *   - Debounce / timeout required?
 * ========================================================================= */

/**
 * Return true if the flow sensor detects no water flow.
 * This is used to detect dry-run: pump is ON but no flow → fault.
 * Return false if flow sensor is not fitted (no dry-run detection).
 */
bool HAL_Flow_IsNone(void);

/**
 * Return true if the flow sensor itself is faulted (disconnected, etc.).
 */
bool HAL_Flow_IsFault(void);

/* =========================================================================
 * SECTION 5: Pump relay
 *
 * REQUIRES HARDWARE TEAM:
 *   - GPIO port and pin for the relay control signal.
 *   - Active-high (relay ON when GPIO high) or active-low?
 *   - Any interlock or delay required before switching?
 * ========================================================================= */

/**
 * Energise the pump relay (start the pump).
 * Must not be called if any safety fault is active — the protocol layer
 * enforces this, but the HAL may add a hardware interlock as well.
 */
void HAL_Relay_PumpOn(void);

/**
 * De-energise the pump relay (stop the pump).
 * Must always be callable regardless of fault state.
 */
void HAL_Relay_PumpOff(void);

/**
 * Return true if the relay is currently energised (pump ON).
 * Used to build accurate telemetry — do not infer from software state alone
 * if the relay can be de-energised by hardware interlock.
 */
bool HAL_Relay_IsOn(void);

/* =========================================================================
 * SECTION 6: System / timing
 * ========================================================================= */

/**
 * Return milliseconds since MCU boot (wraps at ~49 days for uint32_t).
 * Implementation: HAL_GetTick() (STM32 HAL), DWT cycle counter, or a
 * SysTick-based counter. Must be monotonically increasing.
 */
uint32_t HAL_Sys_GetTickMs(void);

/**
 * Initialise all hardware peripherals (clocks, GPIO, ADC, UART, etc.).
 * Called once at the start of main() before any other HAL function.
 */
void HAL_Sys_Init(void);

#ifdef __cplusplus
}
#endif

#endif /* AQUAGUARD_HAL_H */
