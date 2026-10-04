# AquaGuard STM32 Firmware — Build System
#
# Targets:
#   make test          Build and run host-side protocol tests (no hardware needed)
#   make clean         Remove build artefacts
#   make stm32         Cross-compile for STM32F103C8 (requires arm-none-eabi-gcc
#                      and an aquaguard_hal_stm32.c implementation)
#
# Prerequisites for host tests:
#   - GCC (any version supporting C99)  — already present on most Linux/macOS hosts
#   - On Windows: use MSYS2/MinGW, WSL, or Cygwin
#
# Prerequisites for STM32 build:
#   - arm-none-eabi-gcc (install via arm-gnu-toolchain or system package manager)
#   - aquaguard_hal_stm32.c  (hardware team must provide — see aquaguard_hal.h)
#   - startup_stm32f103xb.s  (from STM32CubeF1 or system_stm32f1xx.c)
#   - STM32F103C8Tx_FLASH.ld (linker script from STM32CubeIDE project)

CC_HOST  = gcc
CC_STM32 = arm-none-eabi-gcc

CFLAGS_COMMON = -std=c99 -Wall -Wextra -Wno-unused-parameter

# Host test build flags
CFLAGS_HOST = $(CFLAGS_COMMON) \
              -DAQUAGUARD_HAL_STUB \
              -g \
              -I.

# STM32 cross-compile flags
# Adjust -mcpu and -mfpu if using a Cortex-M4/M7 variant.
CFLAGS_STM32 = $(CFLAGS_COMMON) \
               -mcpu=cortex-m3 \
               -mthumb \
               -DSTM32F103xB \
               -DUSE_HAL_DRIVER \
               -Os \
               -ffunction-sections \
               -fdata-sections \
               -I.

LDFLAGS_STM32 = -mcpu=cortex-m3 \
                -mthumb \
                -specs=nano.specs \
                -T STM32F103C8Tx_FLASH.ld \
                -Wl,--gc-sections \
                -Wl,-Map=aquaguard.map

SRCS_PROTOCOL = aquaguard_protocol.c
SRCS_TEST     = test_protocol.c
# Note: aquaguard_hal_stub.c is #include'd directly into test_protocol.c
# when AQUAGUARD_HAL_STUB is defined.

SRCS_STM32    = aquaguard_protocol.c \
                aquaguard_main.c \
                aquaguard_hal_stm32.c   # hardware team provides this

OUT_TEST  = test_protocol
OUT_STM32 = aquaguard.elf

# ── Host test target ──────────────────────────────────────────────────────

.PHONY: test
test: $(OUT_TEST)
	./$(OUT_TEST)

$(OUT_TEST): $(SRCS_PROTOCOL) $(SRCS_TEST)
	$(CC_HOST) $(CFLAGS_HOST) $(SRCS_PROTOCOL) $(SRCS_TEST) -o $(OUT_TEST)

# ── STM32 cross-compile target ────────────────────────────────────────────

.PHONY: stm32
stm32: $(OUT_STM32)

$(OUT_STM32): $(SRCS_STM32) aquaguard_main.c
	$(CC_STM32) $(CFLAGS_STM32) $(LDFLAGS_STM32) \
	    $(SRCS_STM32) aquaguard_main.c \
	    -o $(OUT_STM32)
	arm-none-eabi-size $(OUT_STM32)

# ── Flash target (requires OpenOCD + ST-Link) ─────────────────────────────

.PHONY: flash
flash: $(OUT_STM32)
	openocd \
	    -f interface/stlink.cfg \
	    -f target/stm32f1x.cfg \
	    -c "program $(OUT_STM32) verify reset exit"

# ── Clean ─────────────────────────────────────────────────────────────────

.PHONY: clean
clean:
	rm -f $(OUT_TEST) $(OUT_STM32) aquaguard.map *.o
