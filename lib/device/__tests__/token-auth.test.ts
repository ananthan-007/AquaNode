import { describe, it, expect } from "vitest";
import {
  generateDeviceToken,
  hashDeviceToken,
  resolveTokenDeviceId,
} from "../token-auth";

// ─── generateDeviceToken ─────────────────────────────────────────────────────

describe("generateDeviceToken", () => {
  it("returns a 64-character hex string", () => {
    const token = generateDeviceToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different value on each call", () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a).not.toBe(b);
  });

  it("has 256 bits of entropy (32 bytes = 64 hex chars)", () => {
    const token = generateDeviceToken();
    expect(token.length).toBe(64);
  });
});

// ─── hashDeviceToken ─────────────────────────────────────────────────────────

describe("hashDeviceToken", () => {
  it("returns a 64-character hex string (SHA-256 digest)", () => {
    const hash = hashDeviceToken("some-token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input always produces same output", () => {
    const raw = "my-test-token-abc123";
    expect(hashDeviceToken(raw)).toBe(hashDeviceToken(raw));
  });

  it("different inputs produce different hashes", () => {
    expect(hashDeviceToken("token-a")).not.toBe(hashDeviceToken("token-b"));
  });

  it("matches the known SHA-256 of the dev device token", () => {
    // This is the pre-computed hash stored in migration 0007.
    // If this test fails, the migration SQL must be updated to match.
    const raw =
      "13e4b82a975563620ab3597132ca3c32fa3f499805934e3d457441afaaa8fee0";
    const expectedHash =
      "a21d2f275d7ab73bd6f2b98da466b399e0e2d63c9f4b18f123265dfd8f1b845c";
    expect(hashDeviceToken(raw)).toBe(expectedHash);
  });

  it("hashing the hash produces a different (non-identity) value", () => {
    const raw = "abc";
    const hash = hashDeviceToken(raw);
    expect(hashDeviceToken(hash)).not.toBe(hash);
  });
});

// ─── resolveTokenDeviceId ─────────────────────────────────────────────────────

describe("resolveTokenDeviceId", () => {
  it("returns registry_device_id when both fields are present", () => {
    const result = resolveTokenDeviceId({
      device_id: "uuid-1234",
      registry_device_id: "AQ-ESP32-AABBCCDDEE00",
    });
    expect(result).toBe("AQ-ESP32-AABBCCDDEE00");
  });

  it("returns device_id (as string) when registry_device_id is null", () => {
    const result = resolveTokenDeviceId({
      device_id: "uuid-5678",
      registry_device_id: null,
    });
    expect(result).toBe("uuid-5678");
  });

  it("returns registry_device_id when device_id is null", () => {
    const result = resolveTokenDeviceId({
      device_id: null,
      registry_device_id: "AQ-ESP32-AABBCCDDEE00",
    });
    expect(result).toBe("AQ-ESP32-AABBCCDDEE00");
  });

  it("returns null when both fields are null", () => {
    const result = resolveTokenDeviceId({
      device_id: null,
      registry_device_id: null,
    });
    expect(result).toBeNull();
  });

  it("registry_device_id takes precedence (not device_id)", () => {
    // Confirms the priority order is explicit, not accidental
    const result = resolveTokenDeviceId({
      device_id: "should-not-be-returned",
      registry_device_id: "AQ-ESP32-WINS",
    });
    expect(result).toBe("AQ-ESP32-WINS");
    expect(result).not.toBe("should-not-be-returned");
  });
});

// ─── Token provisioning flow (end-to-end logic) ───────────────────────────────

describe("Token provisioning flow", () => {
  it("raw token → hash → DB lookup (full roundtrip simulation)", () => {
    // Simulate what provision-device-token route does:
    const rawToken = generateDeviceToken();
    const storedHash = hashDeviceToken(rawToken);

    // Simulate what ingest route does with the incoming Bearer value:
    const incomingToken = rawToken; // ESP32 sends the raw token
    const lookupHash = hashDeviceToken(incomingToken);

    // The hashes must match for the DB lookup to succeed
    expect(lookupHash).toBe(storedHash);
  });

  it("different raw tokens always produce different hashes (no collision risk)", () => {
    const tokens = Array.from({ length: 20 }, () => generateDeviceToken());
    const hashes = tokens.map(hashDeviceToken);
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(20);
  });

  it("raw token is never equal to its own hash (no accidental identity)", () => {
    const raw = generateDeviceToken();
    const hash = hashDeviceToken(raw);
    expect(raw).not.toBe(hash);
  });
});
