import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { deviceId } = await params;

  // Use service role to read device data regardless of RLS ownership.
  // Auth is verified above via session check.
  const { url, anonKey } = getSupabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? anonKey;
  const admin = createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Detect whether deviceId is a UUID (public.devices FK) or text registry ID (AQ-ESP32-...).
  // The ESP32 writes to device_registry (text PK). Only user-claimed devices have device_state.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId);

  if (!isUuid) {
    // Hardware device polling path: read from device_registry
    const { data, error } = await admin
      .from("device_registry")
      .select("*")
      .eq("device_id", deviceId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
    }

    // Map device_registry row to the DeviceState shape CloudTransport expects
    return NextResponse.json({
      deviceState: {
        device_id:        data.device_id,
        water_level:      data.water_level ?? 0,
        voltage:          data.voltage ?? 0,
        voltage_state:    data.voltage_state ?? "NORMAL",
        pump_state:       data.pump_state ?? "OFF",
        mode:             data.mode ?? "AUTO",
        dry_run:          data.dry_run ?? false,
        fault:            data.fault ?? "",
        device_status:    "ONLINE",
        last_seen:        data.last_seen,
        updated_at:       data.last_seen,
        sequence:         data.sequence ?? 0,
        firmware_version: data.firmware_version,
        stm32_connected:  data.stm32_connected,
        last_telemetry_at: data.last_telemetry_at,
      },
    });
  }

  // UUID path: claimed device, read from device_state
  const { data, error } = await admin
    .from("device_state")
    .select("*")
    .eq("device_id", deviceId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  }

  return NextResponse.json({ deviceState: data });
}
