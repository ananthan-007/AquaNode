/**
 * Device identity constants — separate from user identity (Supabase Auth).
 *
 * Architecture:
 *   User identity  → Supabase Auth session ("Who are you?")
 *   Device identity → per-device credential, validated server-side ("Which device?")
 *   Authorization  → devices.owner_id links user to device ("Are you allowed?")
 *   STM32 safety   → hardware-side execute/reject ("Is it safe?")
 *
 * The simulator uses a stable virtual device ID so the same authorization and
 * service boundaries apply without a real ESP32 or device_credentials row.
 */

export const SIM_DEVICE_ID = "sim-device-1";

export const SIM_DEVICE = {
  id: SIM_DEVICE_ID,
  name: "AquaGuard (Simulated)",
} as const;
