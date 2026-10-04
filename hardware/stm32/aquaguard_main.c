/**
 * aquaguard_main.c
 * ================
 * AquaGuard STM32 Firmware — Entry Point
 *
 * This file contains main() and nothing else. All peripheral initialisation
 * is delegated to HAL_Sys_Init() (implemented in aquaguard_hal_stm32.c by
 * the hardware team). All protocol logic is in aquaguard_protocol.c.
 *
 * To port to a new STM32 board:
 *   1. Implement aquaguard_hal.h functions in aquaguard_hal_stm32.c.
 *   2. Add your toolchain startup file and linker script.
 *   3. Build with the flags in Makefile (or import into STM32CubeIDE).
 *   4. This file does not need to change.
 *
 * Build for hardware:  make TARGET=stm32
 * Build for host test: make TARGET=test
 */

#include "aquaguard_hal.h"
#include "aquaguard_protocol.h"

int main(void) {
    /* Initialise clocks, GPIO, ADC, UART, SysTick, etc. */
    HAL_Sys_Init();

    /* Initialise protocol state machine and UART framing. */
    AQ_Protocol_Init();

    /* Main loop — non-blocking tick as fast as possible. */
    for (;;) {
        AQ_Protocol_Tick();
        /* No delay here — HAL_UART_ESP32_ReceiveByte() is non-blocking and
         * the sensor poll is rate-limited internally to SENSOR_POLL_INTERVAL_MS. */
    }

    /* Never reached on embedded target. */
    return 0;
}
