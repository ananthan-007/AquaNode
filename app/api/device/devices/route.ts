import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { HEARTBEAT_ONLINE_MS, HEARTBEAT_OFFLINE_MS } from "@/lib/device/constants";
import type { DiscoveredDevice } from "@/types/hardware";

function getServiceRoleClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Calculates server-side staleness status using server time and the
 * packet-loss-tolerant thresholds from lib/device/constants.ts:
 *
 *   ONLINE  — last_seen within HEARTBEAT_ONLINE_MS  (default 25s)
 *   STALE   — last_seen within HEARTBEAT_OFFLINE_MS (default 60s)
 *   OFFLINE — last_seen older than HEARTBEAT_OFFLINE_MS
 *
 * The 25s ONLINE window tolerates 3 consecutive missed heartbeats at the
 * firmware's default 8s interval before the device is shown as STALE.
 *
 * Exported for re-use in /api/device/handshake.
 */
export function calculateDeviceStatus(
  lastSeenIso: string,
  nowMs = Date.now(),
): "ONLINE" | "STALE" | "OFFLINE" {
  const lastSeenMs = new Date(lastSeenIso).getTime();
  if (Number.isNaN(lastSeenMs)) return "OFFLINE";
  const diffMs = nowMs - lastSeenMs;
  if (diffMs <= HEARTBEAT_ONLINE_MS) return "ONLINE";
  if (diffMs <= HEARTBEAT_OFFLINE_MS) return "STALE";
  return "OFFLINE";
}

/**
 * GET /api/device/devices
 *
 * Backend-powered ESP32 auto-discovery endpoint.
 * Returns registered AquaGuard ESP32 devices and their live connection states.
 *
 * Reads from `device_registry` (ESP32 self-registers via ingest, no user
 * account required) so newly-powered ESP32s appear immediately.
 *
 * Never scans the local network, never uses mDNS, never touches 192.168.x.x.
 * The status is derived server-side from last_seen so the PWA never has to
 * trust a stale "ONLINE" flag from a stored column.
 */
export async function GET(_req: NextRequest) {
  const supabase = getServiceRoleClient();
  const now = Date.now();

  // Primary: read from device_registry (ESP32 self-registration)
  const { data: registryRows, error: registryError } = await supabase
    .from("device_registry")
    .select(
      "device_id, firmware_version, stm32_connected, last_seen, last_telemetry_at, last_heartbeat_at",
    )
    .order("last_seen", { ascending: false });

  if (registryError) {
    // If device_registry doesn't exist yet (migration not applied), fall back
    // to device_state for backward compatibility.
    const { data: states, error: statesError } = await supabase
      .from("device_state")
      .select(
        "device_id, device_status, last_seen, firmware_version, stm32_connected, last_telemetry_at, updated_at",
      );

    if (statesError || !states) {
      return NextResponse.json({ devices: [] as DiscoveredDevice[] });
    }

    const devices: DiscoveredDevice[] = states.map((row) => {
      const lastSeenIso = row.last_seen || row.updated_at || new Date(0).toISOString();
      return {
        deviceId: row.device_id,
        name: `AquaGuard ESP32 (${String(row.device_id).slice(0, 8)})`,
        status: calculateDeviceStatus(lastSeenIso, now),
        lastSeen: lastSeenIso,
        firmwareVersion: row.firmware_version || "1.0.0",
        stm32Connected: Boolean(row.stm32_connected),
        lastTelemetryAt: row.last_telemetry_at || null,
      };
    });

    return NextResponse.json({ devices });
  }

  if (!registryRows) {
    return NextResponse.json({ devices: [] as DiscoveredDevice[] });
  }

  const devices: DiscoveredDevice[] = registryRows.map((row) => {
    const lastSeenIso = row.last_seen || new Date(0).toISOString();
    const derivedStatus = calculateDeviceStatus(lastSeenIso, now);

    return {
      deviceId: row.device_id,
      name: `AquaGuard ESP32 (${String(row.device_id).slice(0, 8)})`,
      status: derivedStatus,
      lastSeen: lastSeenIso,
      firmwareVersion: row.firmware_version || "1.0.0",
      stm32Connected: Boolean(row.stm32_connected),
      lastTelemetryAt: row.last_telemetry_at || null,
    };
  });

  return NextResponse.json({ devices });
}
