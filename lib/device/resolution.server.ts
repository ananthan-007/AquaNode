/**
 * Server-side device resolution — maps an authenticated User to their
 * AquaGuard Device(s). Used by Server Components before rendering pages.
 *
 * Authorization = "Are you allowed to control this device?" (ownership check)
 */

import { createClient } from "@/lib/supabase/server";
import { SIM_DEVICE } from "@/lib/device/identity";
import type { UserDevice } from "@/lib/device/resolution";

const SOURCE = process.env.NEXT_PUBLIC_DEVICE_DATA_SOURCE ?? "simulator";

export async function getUserDevices(): Promise<UserDevice[]> {
  if (SOURCE === "simulator") {
    return [SIM_DEVICE];
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

export async function getPrimaryDevice(): Promise<UserDevice | null> {
  const devices = await getUserDevices();
  return devices[0] ?? null;
}
