/**
 * Server-side device token authentication helpers.
 *
 * Tokens are stored as SHA-256 hex digests in device_tokens.token_hash.
 * The raw token is only ever held by the ESP32 firmware — it is NEVER
 * stored in the database, never logged, and never returned by any API.
 *
 * Flow:
 *   1. Admin provisions a token: generateDeviceToken() → raw token
 *   2. hashDeviceToken(rawToken) → stored in device_tokens.token_hash
 *   3. ESP32 sends raw token in Authorization: Bearer header
 *   4. Ingest route: hashDeviceToken(incomingToken) → DB lookup
 *
 * Why SHA-256 and not bcrypt?
 *   Tokens are 32 random bytes (256 bits of entropy) — they are not
 *   passwords. SHA-256 is appropriate for high-entropy random tokens
 *   where dictionary/brute-force attacks are computationally infeasible.
 *   bcrypt is for low-entropy user passwords. Using bcrypt here would
 *   add 100–300ms to every ESP32 heartbeat/telemetry request for no
 *   security benefit.
 *
 * Server-side only — never import this file from client components.
 */

import { createHash, randomBytes } from "crypto";

/**
 * Generate a new cryptographically random device token.
 * Returns the raw token string (32 hex bytes = 64 hex chars).
 *
 * This value must be stored in the ESP32 firmware as DEVICE_TOKEN.
 * It must NEVER be stored in the database — only its hash is stored.
 */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash a raw device token for storage in device_tokens.token_hash.
 * Deterministic: same input always produces the same output.
 */
export function hashDeviceToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Resolve the effective device ID from a token record.
 *
 * device_tokens rows may reference either:
 *   - registry_device_id (text, e.g. "AQ-ESP32-AABBCCDDEE00") — for ESP32s
 *     that have self-registered in device_registry but are not yet claimed
 *     by a user
 *   - device_id (UUID) — for ESP32s whose devices table row exists
 *
 * registry_device_id takes precedence when both are present.
 */
export function resolveTokenDeviceId(record: {
  device_id: string | null;
  registry_device_id: string | null;
}): string | null {
  if (record.registry_device_id) return record.registry_device_id;
  if (record.device_id) return String(record.device_id);
  return null;
}
