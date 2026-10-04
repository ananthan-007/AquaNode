import { DEVICE_STALE_TIMEOUT_MS } from "./constants";

export type DisplayConnection = "ONLINE" | "STALE" | "OFFLINE";

// OFFLINE threshold is 3× the stale threshold. Both derive from the single
// configurable DEVICE_STALE_TIMEOUT_MS so there is exactly one knob to turn
// once the hardware team confirms the real telemetry interval.
const OFFLINE_TIMEOUT_MS = DEVICE_STALE_TIMEOUT_MS * 3;

/**
 * Derives the UI-facing connection status purely from lastSeen, independent of
 * whatever `deviceStatus` the backend last reported — an old "ONLINE" flag
 * must never be trusted past the staleness window. See CRITICAL rule in
 * master prompt Phase 22.
 *
 * ONLINE  → lastSeen within DEVICE_STALE_TIMEOUT_MS
 * STALE   → lastSeen older than stale timeout but within offline timeout
 * OFFLINE → lastSeen older than offline timeout (3× stale)
 */
export function getDisplayConnection(lastSeenIso: string, now: number = Date.now()): DisplayConnection {
  const lastSeenMs = new Date(lastSeenIso).getTime();
  if (Number.isNaN(lastSeenMs)) return "OFFLINE";
  const age = now - lastSeenMs;
  if (age > OFFLINE_TIMEOUT_MS) return "OFFLINE";
  if (age > DEVICE_STALE_TIMEOUT_MS) return "STALE";
  return "ONLINE";
}

export function formatLastSeen(lastSeenIso: string): string {
  const d = new Date(lastSeenIso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString();
}

