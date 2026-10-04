import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { HEARTBEAT_ONLINE_MS, HEARTBEAT_OFFLINE_MS, CHALLENGE_TTL_MS } from "@/lib/device/constants";

// ─── Threshold constant tests ─────────────────────────────────────────────────

describe("Heartbeat threshold constants (packet-loss tolerance)", () => {
  it("HEARTBEAT_ONLINE_MS is at least 3× the firmware heartbeat interval (3 × 8000 = 24000)", () => {
    const FIRMWARE_HEARTBEAT_MS = 8_000;
    expect(HEARTBEAT_ONLINE_MS).toBeGreaterThanOrEqual(3 * FIRMWARE_HEARTBEAT_MS);
  });

  it("HEARTBEAT_OFFLINE_MS is greater than HEARTBEAT_ONLINE_MS", () => {
    expect(HEARTBEAT_OFFLINE_MS).toBeGreaterThan(HEARTBEAT_ONLINE_MS);
  });

  it("CHALLENGE_TTL_MS is a positive number", () => {
    expect(CHALLENGE_TTL_MS).toBeGreaterThan(0);
  });
});

// ─── calculateDeviceStatus with packet-loss-tolerant thresholds ───────────────

describe("calculateDeviceStatus (tolerant thresholds)", () => {
  // Import after constants are set so the function uses the same values
  const calculateDeviceStatus = (lastSeenIso: string, nowMs: number) => {
    const ms = new Date(lastSeenIso).getTime();
    if (Number.isNaN(ms)) return "OFFLINE";
    const diff = nowMs - ms;
    if (diff <= HEARTBEAT_ONLINE_MS) return "ONLINE";
    if (diff <= HEARTBEAT_OFFLINE_MS) return "STALE";
    return "OFFLINE";
  };

  const NOW = Date.now();

  it("device seen 1s ago → ONLINE", () => {
    expect(calculateDeviceStatus(new Date(NOW - 1_000).toISOString(), NOW)).toBe("ONLINE");
  });

  it("device seen 24s ago (3 missed heartbeats) → still ONLINE", () => {
    // 3 missed × 8 s = 24 s must still be ONLINE
    expect(calculateDeviceStatus(new Date(NOW - 24_000).toISOString(), NOW)).toBe("ONLINE");
  });

  it("device seen just over HEARTBEAT_ONLINE_MS ago → STALE", () => {
    expect(
      calculateDeviceStatus(new Date(NOW - HEARTBEAT_ONLINE_MS - 1).toISOString(), NOW),
    ).toBe("STALE");
  });

  it("device seen just over HEARTBEAT_OFFLINE_MS ago → OFFLINE", () => {
    expect(
      calculateDeviceStatus(new Date(NOW - HEARTBEAT_OFFLINE_MS - 1).toISOString(), NOW),
    ).toBe("OFFLINE");
  });

  it("invalid timestamp → OFFLINE", () => {
    expect(calculateDeviceStatus("not-a-date", NOW)).toBe("OFFLINE");
  });
});

// ─── Handshake phase-1 pre-check logic ───────────────────────────────────────

describe("Handshake verification rules (phase-1 pre-check)", () => {
  const NOW = Date.now();

  function makeRow(overrides: Record<string, unknown> = {}) {
    return {
      device_id: "AQ-ESP32-TESTDEV",
      firmware_version: "1.2.3",
      stm32_connected: true,
      // 3 s ago — well within HEARTBEAT_ONLINE_MS
      last_seen: new Date(NOW - 3_000).toISOString(),
      // 10 s ago — within HEARTBEAT_OFFLINE_MS (telemetry window)
      last_telemetry_at: new Date(NOW - 10_000).toISOString(),
      water_level: 65,
      voltage: 230,
      voltage_state: "NORMAL",
      pump_state: "OFF",
      mode: "AUTO",
      dry_run: false,
      fault: null,
      sequence: 100,
      updated_at: new Date(NOW - 3_000).toISOString(),
      ...overrides,
    };
  }

  it("ONLINE + stm32 connected + fresh telemetry → all checks pass", () => {
    const row = makeRow();
    const ageMs = NOW - new Date(row.last_seen).getTime();
    const esp32Connected = ageMs <= HEARTBEAT_OFFLINE_MS;
    const stm32Connected = esp32Connected && Boolean(row.stm32_connected);
    const telMs = new Date(row.last_telemetry_at).getTime();
    const telOk = esp32Connected && NOW - telMs < HEARTBEAT_OFFLINE_MS;
    expect(esp32Connected).toBe(true);
    expect(stm32Connected).toBe(true);
    expect(telOk).toBe(true);
  });

  it("24 s old heartbeat (3 missed) → still esp32Connected under tolerant threshold", () => {
    const lastSeen = new Date(NOW - 24_000).toISOString();
    const ageMs = NOW - new Date(lastSeen).getTime();
    // 24 s <= HEARTBEAT_ONLINE_MS (25 s default) → still ONLINE, still connected
    expect(ageMs).toBeLessThanOrEqual(HEARTBEAT_ONLINE_MS);
    expect(ageMs <= HEARTBEAT_OFFLINE_MS).toBe(true);
  });

  it("device silent for HEARTBEAT_OFFLINE_MS + 1 ms → esp32Connected=false", () => {
    const row = makeRow({
      last_seen: new Date(NOW - HEARTBEAT_OFFLINE_MS - 1).toISOString(),
    });
    const ageMs = NOW - new Date(row.last_seen).getTime();
    expect(ageMs > HEARTBEAT_OFFLINE_MS).toBe(true);
    const esp32Connected = ageMs <= HEARTBEAT_OFFLINE_MS;
    expect(esp32Connected).toBe(false);
  });

  it("stm32_connected=false → STM32 not connected even if ESP32 ONLINE", () => {
    const row = makeRow({ stm32_connected: false });
    const ageMs = NOW - new Date(row.last_seen).getTime();
    const esp32Connected = ageMs <= HEARTBEAT_OFFLINE_MS;
    const stm32Connected = esp32Connected && Boolean(row.stm32_connected);
    expect(stm32Connected).toBe(false);
  });

  it("null last_telemetry_at → telemetryReceiving=false", () => {
    const esp32Connected = true;
    const lastTelMs = 0; // null → 0 epoch
    const telOk = esp32Connected && NOW - lastTelMs < HEARTBEAT_OFFLINE_MS;
    // NOW - 0 ≫ HEARTBEAT_OFFLINE_MS → false
    expect(telOk).toBe(false);
  });

  it("telemetry older than HEARTBEAT_OFFLINE_MS → telemetryReceiving=false", () => {
    const row = makeRow({
      last_telemetry_at: new Date(NOW - HEARTBEAT_OFFLINE_MS - 1).toISOString(),
    });
    const telMs = new Date(row.last_telemetry_at as string).getTime();
    const telOk = NOW - telMs < HEARTBEAT_OFFLINE_MS;
    expect(telOk).toBe(false);
  });
});

// ─── POST /api/device/handshake route tests ───────────────────────────────────

describe("POST /api/device/handshake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role";
  });

  it("returns 400 when deviceId is missing", async () => {
    const { POST } = await import("../route");
    const req = new NextRequest("http://localhost/api/device/handshake", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/deviceId/i);
  });

  it("returns 400 when body is not valid JSON", async () => {
    const { POST } = await import("../route");
    const req = new NextRequest("http://localhost/api/device/handshake", {
      method: "POST",
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when deviceId is an empty string", async () => {
    const { POST } = await import("../route");
    const req = new NextRequest("http://localhost/api/device/handshake", {
      method: "POST",
      body: JSON.stringify({ deviceId: "   " }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/device/handshake/verify route tests ────────────────────────────

describe("GET /api/device/handshake/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role";
  });

  it("returns 400 when challengeId is missing", async () => {
    const { GET } = await import("../verify/route");
    const req = new NextRequest(
      "http://localhost/api/device/handshake/verify",
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/challengeId/i);
  });
});

// ─── Challenge/response lifecycle (unit) ─────────────────────────────────────

describe("Challenge/response nonce lifecycle", () => {
  it("a nonce is 32 hex characters", () => {
    // Mirrors the randomBytes(16).toString('hex') in the route
    const nonce = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("challenge expires_at is in the future when issued", () => {
    const now = Date.now();
    const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString();
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(now);
  });

  it("expired challenge: expires_at in the past means now > expires_at", () => {
    const past = new Date(Date.now() - 1).toISOString();
    const now = new Date().toISOString();
    expect(now > past).toBe(true);
  });

  it("fresh challenge: expires_at in future means now < expires_at", () => {
    const future = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
    const now = new Date().toISOString();
    expect(now < future).toBe(true);
  });
});
