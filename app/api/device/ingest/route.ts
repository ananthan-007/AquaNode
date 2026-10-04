import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { hashDeviceToken, resolveTokenDeviceId } from "@/lib/device/token-auth";

function getServiceRoleClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * POST /api/device/ingest
 *
 * Ingest endpoint for physical ESP32 hardware.
 * Authenticated via `Authorization: Bearer <DEVICE_TOKEN>`.
 *
 * Handles message types:
 *   - heartbeat       — ESP32 alive, STM32 UART status, firmware version
 *   - telemetry       — full sensor snapshot from STM32 via ESP32
 *   - command_result  — ESP32 relays STM32 command execution result
 *   - event           — notable state transition (fault, pump cycle, etc.)
 *
 * Architecture:
 *   ESP32 → HTTPS POST /api/device/ingest (Bearer token auth)
 *         → upserts device_registry (auto-registration, no user required)
 *         → upserts device_state (if device is user-claimed)
 *
 * No direct browser-to-ESP32 connection. No 192.168.x.x.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Empty token provided" }, { status: 401 });
  }

  // Development / simulator fallback token — allows local hardware testing
  // without DB token provisioning.
  //
  // PRODUCTION RULE: the dev token is unconditionally rejected when
  // NODE_ENV=production, even if HARDWARE_DEVICE_TOKEN happens to still
  // be the default string. This prevents a misconfigured production deploy
  // from accepting unauthenticated ingest traffic.
  const devToken = process.env.HARDWARE_DEVICE_TOKEN || "dev-device-token-secret";
  const isDevToken =
    token === devToken && process.env.NODE_ENV !== "production";

  const supabase = getServiceRoleClient();

  let deviceId: string;

  if (isDevToken) {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.deviceId !== "string" || !body.deviceId) {
      return NextResponse.json(
        { error: "Invalid payload or missing deviceId" },
        { status: 400 },
      );
    }
    deviceId = body.deviceId;
    return await handleIngestPayload(supabase, deviceId, body);
  }

  // Production path: hash the incoming token and look up the digest.
  // token_hash stores SHA-256(rawToken) — never the raw token itself.
  const tokenHash = hashDeviceToken(token);

  const { data: tokenRecord, error: tokenError } = await supabase
    .from("device_tokens")
    .select("device_id, registry_device_id, revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .single();

  if (tokenError || !tokenRecord) {
    return NextResponse.json({ error: "Unauthorized device token" }, { status: 401 });
  }

  const resolvedId = resolveTokenDeviceId({
    device_id: tokenRecord.device_id as string | null,
    registry_device_id: tokenRecord.registry_device_id as string | null,
  });

  if (!resolvedId) {
    return NextResponse.json({ error: "Token has no associated device" }, { status: 401 });
  }

  deviceId = resolvedId;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  return await handleIngestPayload(supabase, deviceId, body);
}

// ─── Types ───────────────────────────────────────────────────────────────

interface IngestBody {
  type?: string;
  deviceId?: string;
  firmwareVersion?: string;
  stm32Connected?: boolean;
  telemetry?: {
    waterLevel?: number;
    voltage?: number;
    voltageState?: string;
    pumpState?: string;
    mode?: string;
    dryRun?: boolean;
    fault?: string | null;
    deviceStatus?: string;
    sequence?: number;
    firmwareVersion?: string;
    stm32Connected?: boolean;
  };
  commandId?: string;
  status?: string;
  reason?: string;
  event?: {
    type: string;
    message: string;
  };
}

// ─── Core handler ─────────────────────────────────────────────────────────

async function handleIngestPayload(
  supabase: ReturnType<typeof getServiceRoleClient>,
  deviceId: string,
  body: IngestBody,
) {
  const { type } = body;
  const nowIso = new Date().toISOString();

  // ── Heartbeat ────────────────────────────────────────────────────────
  if (type === "heartbeat") {
    const firmwareVersion =
      body.firmwareVersion || body.telemetry?.firmwareVersion || "1.0.0";
    const stm32Connected =
      body.stm32Connected !== undefined ? Boolean(body.stm32Connected) : false;

    // Always upsert device_registry for auto-discovery (no user required)
    await upsertDeviceRegistry(supabase, deviceId, {
      firmwareVersion,
      stm32Connected,
      lastSeen: nowIso,
      lastHeartbeatAt: nowIso,
    });

    // Also keep device_state in sync if a row already exists
    await supabase
      .from("device_state")
      .update({
        last_seen: nowIso,
        updated_at: nowIso,
        firmware_version: firmwareVersion,
        stm32_connected: stm32Connected,
        device_status: "ONLINE",
      })
      .eq("device_id", deviceId);

    return NextResponse.json({ success: true, ingested: "heartbeat" });
  }

  // ── Telemetry ────────────────────────────────────────────────────────
  if (type === "telemetry" && body.telemetry) {
    const t = body.telemetry;
    const firmwareVersion =
      body.firmwareVersion || t.firmwareVersion || "1.0.0";
    const stm32Connected =
      body.stm32Connected !== undefined
        ? Boolean(body.stm32Connected)
        : t.stm32Connected !== undefined
          ? Boolean(t.stm32Connected)
          : false;

    const waterLevel = typeof t.waterLevel === "number" ? t.waterLevel : 50;
    const voltage = typeof t.voltage === "number" ? t.voltage : 230;
    const voltageState = t.voltageState || "NORMAL";
    const pumpState = t.pumpState || "OFF";
    const mode = t.mode || "AUTO";
    const dryRun = !!t.dryRun;
    const fault = t.fault || null;
    const sequence =
      typeof t.sequence === "number" ? t.sequence : Date.now();

    // Always upsert device_registry (auto-registration + live telemetry data)
    await upsertDeviceRegistry(supabase, deviceId, {
      firmwareVersion,
      stm32Connected,
      lastSeen: nowIso,
      lastTelemetryAt: nowIso,
      waterLevel,
      voltage,
      voltageState,
      pumpState,
      mode,
      dryRun,
      fault,
      sequence,
    });

    // Upsert device_state for user-claimed devices (full telemetry)
    const { error } = await supabase.from("device_state").upsert({
      device_id: deviceId,
      water_level: waterLevel,
      voltage,
      voltage_state: voltageState,
      pump_state: pumpState,
      mode,
      dry_run: dryRun,
      fault,
      device_status: t.deviceStatus || "ONLINE",
      last_seen: nowIso,
      updated_at: nowIso,
      sequence,
      firmware_version: firmwareVersion,
      stm32_connected: stm32Connected,
      last_telemetry_at: nowIso,
    });

    if (error) {
      // device_state upsert fails if no matching devices row (unclaimed device)
      // This is fine — device_registry has the data for discovery.
      // Only return error if it's NOT a FK violation.
      if (!error.message.includes("violates foreign key")) {
        return NextResponse.json(
          { error: `Telemetry ingest failed: ${error.message}` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true, ingested: "telemetry" });
  }

  // ── Command result ────────────────────────────────────────────────────
  if (type === "command_result" && body.commandId && body.status) {
    const { commandId, status, reason } = body;
    const validStatuses = ["RECEIVED", "EXECUTED", "REJECTED", "FAILED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid command status" }, { status: 400 });
    }

    const { error } = await supabase
      .from("commands")
      .update({
        status,
        reason: reason || null,
        updated_at: nowIso,
      })
      .eq("id", commandId)
      .eq("device_id", deviceId);

    if (error) {
      return NextResponse.json(
        { error: `Command result update failed: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      ingested: "command_result",
      commandId,
      status,
    });
  }

  // ── Event ─────────────────────────────────────────────────────────────
  if (type === "event" && body.event) {
    const e = body.event;

    // Update device_registry last_seen
    await upsertDeviceRegistry(supabase, deviceId, { lastSeen: nowIso });

    const { error } = await supabase.from("events").insert({
      device_id: deviceId,
      type: e.type,
      message: e.message,
      created_at: nowIso,
    });

    if (error) {
      // FK violation means device not in devices table — not fatal for registry
      if (!error.message.includes("violates foreign key")) {
        return NextResponse.json(
          { error: `Event record failed: ${error.message}` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true, ingested: "event" });
  }

  // ── Challenge response ───────────────────────────────────────────────────
  // ESP32 echoes back the nonce it received via GET /api/device/commands/pending.
  // This is the live proof that the device is communicating right now, not just
  // that the database has a recent timestamp.
  if (type === "challenge_response") {
    const nonce =
      typeof (body as Record<string, unknown>).nonce === "string"
        ? String((body as Record<string, unknown>).nonce).trim()
        : null;

    if (!nonce) {
      return NextResponse.json(
        { error: "Missing nonce in challenge_response" },
        { status: 400 },
      );
    }

    const { error: challengeError } = await supabase
      .from("device_challenges")
      .update({ responded_at: nowIso, response_ok: true })
      .eq("device_id", deviceId)
      .eq("nonce", nonce)
      .eq("response_ok", false);

    if (challengeError) {
      if (
        !challengeError.message.includes("does not exist") &&
        !challengeError.message.includes("relation")
      ) {
        return NextResponse.json(
          { error: `Challenge response failed: ${challengeError.message}` },
          { status: 500 },
        );
      }
    }

    await upsertDeviceRegistry(supabase, deviceId, { lastSeen: nowIso });

    return NextResponse.json({
      success: true,
      ingested: "challenge_response",
      nonce,
    });
  }

  // ── Unknown type ─────────────────────────────────────────────────────────
  return NextResponse.json(
    { error: "Unknown or malformed ingest message type" },
    { status: 400 },
  );
}

// ─── device_registry helper ───────────────────────────────────────────────

interface RegistryUpdate {
  firmwareVersion?: string;
  stm32Connected?: boolean;
  lastSeen?: string;
  lastHeartbeatAt?: string;
  lastTelemetryAt?: string;
  waterLevel?: number;
  voltage?: number;
  voltageState?: string;
  pumpState?: string;
  mode?: string;
  dryRun?: boolean;
  fault?: string | null;
  sequence?: number;
}

async function upsertDeviceRegistry(
  supabase: ReturnType<typeof getServiceRoleClient>,
  deviceId: string,
  update: RegistryUpdate,
): Promise<void> {
  // Build upsert object — only include defined fields
  const row: Record<string, unknown> = {
    device_id: deviceId,
    last_seen: update.lastSeen ?? new Date().toISOString(),
  };

  if (update.firmwareVersion !== undefined)
    row.firmware_version = update.firmwareVersion;
  if (update.stm32Connected !== undefined)
    row.stm32_connected = update.stm32Connected;
  if (update.lastHeartbeatAt !== undefined)
    row.last_heartbeat_at = update.lastHeartbeatAt;
  if (update.lastTelemetryAt !== undefined)
    row.last_telemetry_at = update.lastTelemetryAt;
  if (update.waterLevel !== undefined) row.water_level = update.waterLevel;
  if (update.voltage !== undefined) row.voltage = update.voltage;
  if (update.voltageState !== undefined)
    row.voltage_state = update.voltageState;
  if (update.pumpState !== undefined) row.pump_state = update.pumpState;
  if (update.mode !== undefined) row.mode = update.mode;
  if (update.dryRun !== undefined) row.dry_run = update.dryRun;
  if (update.fault !== undefined) row.fault = update.fault;
  if (update.sequence !== undefined) row.sequence = update.sequence;

  // Upsert — merge strategy: update existing columns, insert on first call
  try {
    await supabase
      .from("device_registry")
      .upsert(row, { onConflict: "device_id" });
  } catch {
    // Silently ignore if device_registry table doesn't exist yet
    // (migration 0004 not applied). Ingest still works via device_state.
  }
}
