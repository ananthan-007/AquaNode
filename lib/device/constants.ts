// NOT specified by requirements — internal defaults, documented in
// docs/WEB_APP_SPEC.md. All configurable via env vars (server-side only —
// do NOT prefix with NEXT_PUBLIC_).
//
// Firmware sends heartbeats every 8s. Thresholds are set with enough headroom
// to tolerate 2–3 consecutive missed packets before the device goes STALE:
//
//   ONLINE:  last_seen within 25s  → 3 missed heartbeats @ 8s = 24s, +1s buffer
//   STALE:   last_seen 25s–60s     → slow network / recovering device
//   OFFLINE: last_seen > 60s       → device genuinely unreachable

/** Milliseconds after last heartbeat before device shows as STALE (not ONLINE). */
export const HEARTBEAT_ONLINE_MS = Number(
  process.env.HEARTBEAT_ONLINE_MS ?? 25_000,
);

/** Milliseconds after last heartbeat before device shows as OFFLINE (not STALE). */
export const HEARTBEAT_OFFLINE_MS = Number(
  process.env.HEARTBEAT_OFFLINE_MS ?? 60_000,
);

/**
 * @deprecated Use HEARTBEAT_ONLINE_MS / HEARTBEAT_OFFLINE_MS instead.
 * Kept for backward-compatibility with existing client-side staleness helpers
 * that derive STALE/OFFLINE from a single threshold. Points to HEARTBEAT_ONLINE_MS.
 */
export const DEVICE_STALE_TIMEOUT_MS = HEARTBEAT_ONLINE_MS;

/** TTL (ms) for a live handshake challenge before it expires. */
export const CHALLENGE_TTL_MS = Number(
  process.env.CHALLENGE_TTL_MS ?? 15_000,
);

/**
 * How long (ms) CloudTransport polls the verify endpoint waiting for the
 * ESP32 to echo the challenge nonce back. Must be < CHALLENGE_TTL_MS.
 */
export const CHALLENGE_POLL_TIMEOUT_MS = Number(
  process.env.CHALLENGE_POLL_TIMEOUT_MS ?? 12_000,
);

/** How often (ms) CloudTransport polls /handshake/verify while waiting. */
export const CHALLENGE_POLL_INTERVAL_MS = 1_500;
