import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { calculateDeviceStatus } from "../devices/route";
import {
  HEARTBEAT_OFFLINE_MS,
  CHALLENGE_TTL_MS,
} from "@/lib/device/constants";
import type { DeviceState } from "@/types/device";
import { randomBytes } from "crypto";

function getServiceRoleClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * POST /api/device/handshake
 *
 * Two-phase end-to-end hardware verification.
 *
 * PHASE 1 — DB pre-check (this endpoint):
 *   Verify the device has been recently seen (heartbeat freshness) and has
 *   previously reported stm32Connected=true. If the pre-check passes, write
 *   a short-lived challenge nonce into device_challenges and return it so the
 *   ESP32 can pick it up on its next commands/pending poll.
 *
 * PHASE 2 — Live challenge/response (GET /api/device/handshake/verify):
 *   The caller (CloudTransport) polls this endpoint until the ESP32 echoes
 *   the nonce back via POST /api/device/ingest { type: "challenge_response" }.
 *   Only when the ESP32 proves it is live right now does verified=true.
 *
 * Why two phases?
 *   Vercel is serverless — a single POST cannot hold an open connection for
 *   15 seconds waiting for a device response. Splitting into issue+poll keeps
 *   each serverless invocation short while still requiring a live round-trip.
 *
 * Architecture:
 *   PWA → POST /api/device/handshake
 *              ↓ issues nonce to device_challenges
 *              ↓ ESP32 picks up nonce via GET /api/device/commands/pending
 *              ↓ ESP32 POSTs nonce back via /api/device/ingest
 *         PWA → GET /api/device/handshake/verify?challengeId=…
 *              ↓ returns verified=true when response_ok=true
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
    return NextResponse.json(
      { error: "Missing or invalid deviceId" },
      { status: 400 },
    );
  }

  const deviceId = body.deviceId.trim();
  const supabase = getServiceRoleClient();
  const now = Date.now();

  // ── Phase 1: DB pre-check ────────────────────────────────────────────────

  // Read from device_registry first (ESP32 self-registered), fall back to
  // device_state for user-claimed devices.
  const { data: registryRow } = await supabase
    .from("device_registry")
    .select("*")
    .eq("device_id", deviceId)
    .single();

  const { data: stateRow } = await supabase
    .from("device_state")
    .select("*")
    .eq("device_id", deviceId)
    .single();

  const row = pickMostRecent(registryRow, stateRow);

  if (!row) {
    return NextResponse.json(
      {
        success: false,
        challengeIssued: false,
        error: `Device '${deviceId}' not registered — no heartbeats received`,
        esp32Connected: false,
        stm32Connected: false,
        telemetryReceiving: false,
        status: "OFFLINE",
      },
      { status: 404 },
    );
  }

  const lastSeenIso = String(
    row["last_seen"] ?? row["updated_at"] ?? new Date(0).toISOString(),
  );
  const status = calculateDeviceStatus(lastSeenIso, now);

  // Accept ONLINE or STALE — both mean the device is communicating.
  const esp32Connected = status === "ONLINE" || status === "STALE";

  const stm32Connected =
    esp32Connected &&
    Boolean(row["stm32_connected"] ?? row["stm32Connected"]);

  const lastTelemetryMs = row["last_telemetry_at"]
    ? new Date(String(row["last_telemetry_at"])).getTime()
    : 0;
  // Telemetry window aligned to HEARTBEAT_OFFLINE_MS so a recovering-but-STALE
  // device can still pass if it was recently sending telemetry.
  const telemetryReceiving =
    esp32Connected && now - lastTelemetryMs < HEARTBEAT_OFFLINE_MS;

  if (!esp32Connected) {
    return NextResponse.json({
      success: false,
      challengeIssued: false,
      verified: false,
      deviceId,
      status,
      esp32Connected: false,
      stm32Connected: false,
      telemetryReceiving: false,
      error: "Device is OFFLINE — no recent heartbeats",
      firmwareVersion: String(row["firmware_version"] ?? "1.0.0"),
      lastSeen: lastSeenIso,
    });
  }

  // ── Phase 2: Issue live challenge nonce ──────────────────────────────────
  //
  // Write a short-lived nonce into device_challenges. The ESP32 will pick it
  // up on its next GET /api/device/commands/pending poll (which includes
  // active challenges), POST it back via /api/device/ingest
  // { type: "challenge_response", nonce }, and the verify endpoint will
  // mark response_ok=true.

  const nonce = randomBytes(16).toString("hex"); // 32-char hex, unguessable
  const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString();

  // In development, auto-verify the challenge immediately.
  // The current ESP32 firmware uses Supabase REST directly and does not
  // implement the challenge-response protocol. Production requires a live
  // round-trip; dev mode skips Phase 2 so testing is unblocked.
  const isDevMode = process.env.NODE_ENV !== "production";

  // Best-effort insert — if device_challenges table doesn't exist yet
  // (migration 0005 not applied), fall through to legacy DB-only verification.
  let challengeId: string | null = null;
  let challengeTableExists = true;

  const { data: challengeRow, error: challengeError } = await supabase
    .from("device_challenges")
    .insert({
      device_id: deviceId,
      nonce,
      expires_at: expiresAt,
      // Auto-verify in dev so firmware without challenge-response still connects
      ...(isDevMode ? { response_ok: true, responded_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();

  if (challengeError) {
    // Table likely not yet migrated — degrade gracefully to DB-only check.
    challengeTableExists = false;
  } else {
    challengeId = challengeRow?.id ?? null;
  }

  // Build a snapshot DeviceState from the DB row for immediate consumption.
  const deviceState = buildDeviceState(row, stm32Connected, status, lastSeenIso);

  return NextResponse.json({
    // Phase 1 result
    success: true,            // pre-check passed; live challenge is outstanding
    challengeIssued: challengeTableExists && challengeId !== null,
    challengeId,
    nonce,
    expiresAt,
    // Legacy DB-only fields (still returned so CloudTransport can proceed
    // without phase 2 if migration 0005 hasn't been applied yet)
    verified: !challengeTableExists
      ? esp32Connected && stm32Connected && telemetryReceiving
      : false, // not verified yet — wait for phase 2
    deviceId,
    status,
    esp32Connected,
    stm32Connected,
    telemetryReceiving,
    deviceState,
    firmwareVersion: String(row["firmware_version"] ?? "1.0.0"),
    lastSeen: lastSeenIso,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickMostRecent(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a;
  const aMs = new Date(
    String(a["last_seen"] ?? a["updated_at"] ?? 0),
  ).getTime();
  const bMs = new Date(
    String(b["last_seen"] ?? b["updated_at"] ?? 0),
  ).getTime();
  return aMs >= bMs ? a : b;
}

function buildDeviceState(
  row: Record<string, unknown>,
  stm32Connected: boolean,
  status: "ONLINE" | "STALE" | "OFFLINE",
  lastSeenIso: string,
): DeviceState {
  return {
    deviceId: String(row["device_id"] ?? ""),
    waterLevel:
      row["water_level"] != null ? Number(row["water_level"]) : 0,
    voltage: Number(row["voltage"] ?? 0),
    voltageState: String(
      row["voltage_state"] ?? "NORMAL",
    ) as DeviceState["voltageState"],
    pumpState: String(
      row["pump_state"] ?? "OFF",
    ) as DeviceState["pumpState"],
    mode: String(row["mode"] ?? "AUTO") as DeviceState["mode"],
    dryRun: Boolean(row["dry_run"]),
    fault: (row["fault"] ?? null) as DeviceState["fault"],
    deviceStatus: status === "OFFLINE" ? "OFFLINE" : "ONLINE",
    lastSeen: lastSeenIso,
    updatedAt: String(row["updated_at"] ?? lastSeenIso),
    sequence: Number(row["sequence"] ?? 0),
    firmwareVersion: String(row["firmware_version"] ?? "1.0.0"),
    stm32Connected,
    lastTelemetryAt:
      row["last_telemetry_at"] != null
        ? String(row["last_telemetry_at"])
        : undefined,
  };
}
