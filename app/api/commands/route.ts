import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  const { data, error } = await supabase
    .from("commands")
    .insert({ device_id: body.deviceId, type: body.type, requested_by: user.id, status: "PENDING" })
    .select("id, status")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  return NextResponse.json({ commandId: data.id, status: data.status });
}
