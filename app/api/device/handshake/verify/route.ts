import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

function getServiceRoleClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * GET /api/device/handshake/verify?challengeId=<uuid>
 *
 * Phase 2 of the live handshake: poll whether the ESP32 has echoed back
 * the nonce issued in POST /api/device/handshake.
 *
 * Returns:
 *   { verified: true }  — ESP32 responded with the correct nonce in time
 *   { verified: false, pending: true }  — challenge still open, keep polling
 *   { verified: false, expired: true }  — TTL elapsed, handshake failed
 *   { verified: false, error: "..." }   — challenge not found or already used
 *
 * Called by CloudTransport on a 1.5s poll loop for up to CHALLENGE_POLL_TIMEOUT_MS.
 *
 * The ESP32 side:
 *   1. Picks up the nonce via GET /api/device/commands/pending
 *      (challenges are included alongside commands in that response)
 *   2. POSTs back: { type: "challenge_response", nonce, deviceId }
 *      via /api/device/ingest
 *   3. Ingest handler marks device_challenges.response_ok = true
 */
export async function GET(req: NextRequest) {
  const challengeId = req.nextUrl.searchParams.get("challengeId");
  if (!challengeId) {
    return NextResponse.json(
      { error: "Missing challengeId" },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();
  const now = new Date().toISOString();

  const { data: challenge, error } = await supabase
    .from("device_challenges")
    .select("id, device_id, nonce, issued_at, expires_at, responded_at, response_ok")
    .eq("id", challengeId)
    .single();

  if (error || !challenge) {
    return NextResponse.json(
      { verified: false, error: "Challenge not found" },
      { status: 404 },
    );
  }

  // Already verified
  if (challenge.response_ok) {
    return NextResponse.json({ verified: true, deviceId: challenge.device_id });
  }

  // Expired
  if (now > challenge.expires_at) {
    return NextResponse.json({
      verified: false,
      expired: true,
      error: "Challenge expired — ESP32 did not respond in time",
    });
  }

  // Still waiting
  return NextResponse.json({
    verified: false,
    pending: true,
    expiresAt: challenge.expires_at,
  });
}
