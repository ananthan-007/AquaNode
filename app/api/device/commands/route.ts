import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { hashDeviceToken } from "@/lib/device/token-auth";

function getServiceRoleClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * GET /api/device/commands/pending?deviceId=<id>
 *
 * ESP32-facing endpoint — returns PENDING user commands and any outstanding
 * live handshake challenges for this device. Authenticated via Bearer token.
 *
 * The ESP32 polls this every 2 seconds. For each item it receives:
 *   - commands: relay to STM32 over UART, POST result to /api/device/ingest
 *   - challenges: echo the nonce back via POST /api/device/ingest
 *                 { type: "challenge_response", nonce, deviceId }
 *
 * This is the mechanism that enables the two-phase live handshake:
 *   PWA issues challenge → ESP32 picks it up here → ESP32 echoes nonce
 *   → /ingest marks challenge as responded → /handshake/verify returns true.
 */
export async function GET(req: NextRequest) {
  // ── Bearer token auth ────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  const token = authHeader.slice(7).trim();
  const devToken = process.env.HARDWARE_DEVICE_TOKEN || "dev-device-token-secret";

  // Dev token is only accepted outside production.
  // See also: isDevelopmentToken() in ingest/route.ts for the same rule.
  const isDevToken =
    token === devToken && process.env.NODE_ENV !== "production";

  if (!isDevToken) {
    const supabase = getServiceRoleClient();
    // Hash the incoming token before lookup — token_hash stores SHA-256 digests.
    const tokenHash = hashDeviceToken(token);
    const { data: tokenRecord, error } = await supabase
      .from("device_tokens")
      .select("device_id, registry_device_id, revoked_at")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .single();

    if (error || !tokenRecord) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const deviceId = req.nextUrl.searchParams.get("deviceId");
  if (!deviceId) {
    return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();
  const now = new Date();

  // ── PENDING commands (not yet timed out) ─────────────────────────────────
  // 30s window aligns with the command timeout in DashboardClient.
  const thirtySecondsAgo = new Date(now.getTime() - 30_000).toISOString();

  const { data: commands, error: cmdError } = await supabase
    .from("commands")
    .select("id, type, status, created_at")
    .eq("device_id", deviceId)
    .eq("status", "PENDING")
    .gte("created_at", thirtySecondsAgo)
    .order("created_at", { ascending: true })
    .limit(10);

  if (cmdError) {
    return NextResponse.json({ error: cmdError.message }, { status: 500 });
  }

  // ── Active handshake challenges ───────────────────────────────────────────
  // Return challenges that are not yet responded to and not yet expired.
  // If device_challenges table doesn't exist, skip silently.
  let challenges: Array<{ id: string; nonce: string }> = [];

  const { data: challengeRows } = await supabase
    .from("device_challenges")
    .select("id, nonce")
    .eq("device_id", deviceId)
    .eq("response_ok", false)
    .gt("expires_at", now.toISOString())
    .order("issued_at", { ascending: true })
    .limit(3);

  if (challengeRows) {
    challenges = challengeRows.map((r) => ({ id: r.id, nonce: r.nonce }));
  }

  return NextResponse.json({
    commands: commands ?? [],
    challenges,
  });
}
