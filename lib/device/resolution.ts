/**
 * Client-side device resolution — maps an authenticated User to their
 * AquaGuard Device(s). Server Components should use resolution.server.ts.
 *
 *   Authentication = "Who are you?" (Supabase Auth)
 *   Authorization  = "Are you allowed to control this device?" (ownership)
 *   STM32 Safety   = "Is it safe to execute?" (device-side, not here)
 *
 * Phase-1 scope: single device per user. Multi-device is Phase-2.
 */

import { createClient } from "@/lib/supabase/client";
import { SIM_DEVICE } from "@/lib/device/identity";

const SOURCE = process.env.NEXT_PUBLIC_DEVICE_DATA_SOURCE ?? "simulator";

export interface UserDevice {
  id: string;
  name: string;
}

/**
 * Resolve the authenticated user's device(s).
 *
 * Returns the list of devices the current user owns. In Phase-1 this will
 * be 0 or 1 devices. Returns an empty array if the user has no devices
 * (which is a valid state — they need to register/provision one).
 */
export async function getUserDevices(): Promise<UserDevice[]> {
  if (SOURCE === "simulator") {
    return [SIM_DEVICE];
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("devices")
    .select("id, name")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data.map((d) => ({
    id: d.id,
    name: d.name ?? "AquaGuard",
  }));
}

/**
 * Resolve the user's primary (first) device.
 * Returns null if the user has no devices registered.
 */
export async function getPrimaryDevice(): Promise<UserDevice | null> {
  const devices = await getUserDevices();
  return devices[0] ?? null;
}
