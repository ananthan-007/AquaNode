import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { generateDeviceToken, hashDeviceToken } from "@/lib/device/token-auth";

function getServiceRoleClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * POST /api/admin/provision-device-token
 *
 * Provisions a unique Bearer token for one AquaGuard ESP32 device.
 * Requires an authenticated Supabase session (the logged-in user must own the
 * device, or the device must exist in device_registry as unclaimed).
 *
 * Request body:
 * {
 *   "registryDeviceId": "AQ-ESP32-AABBCCDDEE00",   // ESP32 MAC-based ID
 *   "description": "Dev unit - bench test"          // optional label
 * }
 *
 * Response (200):
 * {
 *   "rawToken": "...",    // 64-char hex — give this to the ESP32 operator
 *   "tokenId": "uuid",
 *   "registryDeviceId": "AQ-ESP32-AABBCCDDEE00",
 *   "description": "Dev unit - bench test"
 * }
 *
 * SECURITY RULES:
 *   - The raw token is returned ONCE and is never stored. It must be
 *     immediately set as DEVICE_TOKEN in the ESP32 firmware.
 *   - token_hash (SHA-256 of rawToken) is what gets stored in the database.
 *   - This endpoint requires an authenticated user session. Unauthenticated
 *     requests are rejected with 401.
 *   - A device may have multiple active tokens (e.g. during firmware rotation).
 *     Old tokens can be revoked by setting revoked_at via the Supabase dashboard
 *     or a future /api/admin/revoke-device-token endpoint.
 *   - This endpoint is not accessible from the browser PWA UI — it is intended
 *     for developer/operator use during device provisioning.
 */
export async function POST(req: NextRequest) {
  // ── Require authenticated user session ────────────────────────────────────
  const supabaseUser = await createServerClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  // ── Parse request body ────────────────────────────────────────────────────
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body["registryDeviceId"] !== "string" || !body["registryDeviceId"].trim()) {
    return NextResponse.json(
      { error: "Missing or invalid registryDeviceId" },
      { status: 400 },
    );
  }

  const registryDeviceId = (body["registryDeviceId"] as string).trim();
  const description =
    typeof body["description"] === "string" && body["description"].trim()
      ? (body["description"] as string).trim()
      : `ESP32 token — ${registryDeviceId}`;

  const serviceSupabase = getServiceRoleClient();

  // ── Verify the device exists in device_registry ───────────────────────────
  const { data: registryRow, error: registryError } = await serviceSupabase
    .from("device_registry")
    .select("device_id, owner_id")
    .eq("device_id", registryDeviceId)
    .single();

  if (registryError || !registryRow) {
    return NextResponse.json(
      {
        error: `Device '${registryDeviceId}' not found in device_registry. ` +
          "The ESP32 must send at least one heartbeat before a token can be provisioned.",
      },
      { status: 404 },
    );
  }

  // ── Authorization: only the device owner (or unclaimed device) can provision ──
  if (registryRow.owner_id !== null && registryRow.owner_id !== user.id) {
    return NextResponse.json(
      { error: "You do not own this device" },
      { status: 403 },
    );
  }

  // ── Generate token ────────────────────────────────────────────────────────
  const rawToken = generateDeviceToken();   // 32 random bytes → 64 hex chars
  const tokenHash = hashDeviceToken(rawToken); // SHA-256(rawToken) → stored

  // ── Store hash (never the raw token) ─────────────────────────────────────
  const { data: tokenRow, error: insertError } = await serviceSupabase
    .from("device_tokens")
    .insert({
      registry_device_id: registryDeviceId,
      device_id: null,              // null: unclaimed device, registry ID used
      token_hash: tokenHash,
      description,
    })
    .select("id, description, created_at")
    .single();

  if (insertError || !tokenRow) {
    return NextResponse.json(
      { error: `Failed to store token: ${insertError?.message ?? "unknown error"}` },
      { status: 500 },
    );
  }

  // ── Return the raw token — only time it will ever be visible ─────────────
  return NextResponse.json({
    rawToken,
    tokenId: tokenRow.id,
    registryDeviceId,
    description: tokenRow.description,
    createdAt: tokenRow.created_at,
    // Remind the caller what to do with this value
    instructions: [
      `Set DEVICE_TOKEN="${rawToken}" in hardware/esp32/aquaguard_esp32.ino`,
      "Flash the firmware.",
      "This token will not be shown again — store it securely.",
      "To revoke: set revoked_at on row id=" + tokenRow.id + " in device_tokens.",
    ],
  });
}
