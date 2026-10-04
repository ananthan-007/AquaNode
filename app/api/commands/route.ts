import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

const VALID_TYPES = [
  "PUMP_ON",
  "PUMP_OFF",
  "SET_MODE_AUTO",
  "SET_MODE_MANUAL",
  "FAULT_RESET",
  "REQUEST_LEVEL",
];

// Creates a command REQUEST only. Never writes device_state. Authorization
// is enforced twice: the session check below, and RLS on the `commands`
// insert policy (see supabase/migrations/0001_init.sql).
export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.deviceId !== "string" || !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "Invalid command payload" }, { status: 400 });
  }

  // deviceId may be a UUID (public.devices FK) or a text registry ID (AQ-ESP32-...).
  // registry_device_id lets the ESP32 poll PENDING commands by its own text device ID.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    body.deviceId,
  );

  // Service role bypasses RLS — auth is validated manually above.
  const { url, anonKey } = getSupabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? anonKey;
  const admin = createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("commands")
    .insert({
      type: body.type,
      requested_by: user.id,
      status: "PENDING",
      device_id: isUuid ? body.deviceId : null,
      registry_device_id: isUuid ? null : body.deviceId,
    })
    .select("id, status")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  return NextResponse.json({ commandId: data.id, status: data.status });
}
