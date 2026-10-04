/**
 * Server-side device resolution — maps an authenticated User to their
 * AquaGuard Device(s). Used by Server Components before rendering pages.
 *
 * Hardware-only: always reads from device_registry (text PK).
 * The ESP32's device ID is used directly — no UUID FK lookup needed.
 */

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import type { UserDevice } from "@/lib/device/resolution";

const HARDWARE_DEVICE_ID =
  process.env.NEXT_PUBLIC_HARDWARE_DEVICE_ID ?? "AQ-ESP32-DEV000000001";

export async function getUserDevices(): Promise<UserDevice[]> {
  // Hardware-only: verify the user is authenticated, then return the
  // registered hardware device ID directly from the registry.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Read the device from registry so we get a real name/firmware version.
  const { url, anonKey } = getSupabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? anonKey;
  const admin = createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data } = await admin
    .from("device_registry")
    .select("device_id, firmware_version")
    .eq("device_id", HARDWARE_DEVICE_ID)
    .single();

  if (!data) {
    // Device hasn't registered yet (never powered on / sent a heartbeat),
    // but still return it so the dashboard can show "not connected".
    return [{ id: HARDWARE_DEVICE_ID, name: "AquaGuard ESP32" }];
  }

  return [
    {
      id: data.device_id,
      name: `AquaGuard ESP32${data.firmware_version ? ` (FW ${data.firmware_version})` : ""}`,
    },
  ];
}

export async function getPrimaryDevice(): Promise<UserDevice | null> {
  const devices = await getUserDevices();
  return devices[0] ?? null;
}
