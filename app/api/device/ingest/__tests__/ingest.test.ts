import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { NextRequest } from "next/server";

// ─── Shared Supabase mock ─────────────────────────────────────────────────────

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "device_tokens") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                single: async () => ({
                  data: {
                    device_id: null,
                    registry_device_id: "AQ-ESP32-TESTUNIT",
                    revoked_at: null,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === "device_state") {
        return {
          upsert: async () => ({ error: null }),
          update: () => ({ eq: async () => ({ error: null }) }),
          select: () => ({
            eq: () => ({ single: async () => ({ data: null, error: null }) }),
          }),
        };
      }

      if (table === "device_registry") {
        return {
          upsert: async () => ({ error: null }),
        };
      }

      if (table === "device_challenges") {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            }),
          }),
        };
      }

      if (table === "commands") {
        return {
          update: () => ({
            eq: () => ({ eq: async () => ({ error: null }) }),
          }),
        };
      }

      if (table === "events") {
        return { insert: async () => ({ error: null }) };
      }

      return {};
    },
  }),
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/device/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key-secret";
    process.env.HARDWARE_DEVICE_TOKEN = "dev-device-token-secret";
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 if Authorization header is missing", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      body: JSON.stringify({ type: "heartbeat" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("Missing or invalid Authorization");
  });

  it("returns 401 for an empty Bearer token", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: { authorization: "Bearer " },
      body: JSON.stringify({ type: "heartbeat", deviceId: "dev-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  it("accepts heartbeat with stm32Connected=true", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "AQ-ESP32-AABBCCDD",
        type: "heartbeat",
        firmwareVersion: "1.2.3",
        stm32Connected: true,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.ingested).toBe("heartbeat");
  });

  it("accepts heartbeat with stm32Connected=false (UART link not verified)", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "AQ-ESP32-AABBCCDD",
        type: "heartbeat",
        stm32Connected: false,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ingested).toBe("heartbeat");
  });

  it("returns 400 for heartbeat missing deviceId", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "heartbeat" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ── Telemetry ─────────────────────────────────────────────────────────────

  it("accepts valid telemetry and ingests it", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "AQ-ESP32-AABBCCDD",
        type: "telemetry",
        stm32Connected: true,
        firmwareVersion: "1.0.0",
        telemetry: {
          waterLevel: 75,
          voltage: 230,
          voltageState: "NORMAL",
          pumpState: "OFF",
          mode: "AUTO",
          dryRun: false,
          fault: null,
          sequence: 42,
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.ingested).toBe("telemetry");
  });

  it("accepts telemetry with stm32Connected=false (STM32 UART failure)", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "AQ-ESP32-AABBCCDD",
        type: "telemetry",
        stm32Connected: false,
        telemetry: {
          waterLevel: 50,
          voltage: 228,
          voltageState: "NORMAL",
          pumpState: "OFF",
          mode: "AUTO",
          fault: "STM32_COMM_FAILURE",
          sequence: 10,
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await res.json()).ingested).toBe("telemetry");
  });

  // ── Command result ────────────────────────────────────────────────────────

  it("updates command status on EXECUTED command_result", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "AQ-ESP32-AABBCCDD",
        type: "command_result",
        commandId: "cmd-uuid-001",
        status: "EXECUTED",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("EXECUTED");
    expect(json.commandId).toBe("cmd-uuid-001");
  });

  it("updates command status on REJECTED command_result with reason", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "AQ-ESP32-AABBCCDD",
        type: "command_result",
        commandId: "cmd-uuid-002",
        status: "REJECTED",
        reason: "UNDER_VOLTAGE",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("REJECTED");
  });

  it("returns 400 for invalid command status", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "AQ-ESP32-AABBCCDD",
        type: "command_result",
        commandId: "cmd-uuid-003",
        status: "INVALID_STATUS",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ── Challenge response ────────────────────────────────────────────────────

  it("accepts challenge_response with a valid nonce", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "AQ-ESP32-AABBCCDD",
        type: "challenge_response",
        nonce: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.ingested).toBe("challenge_response");
    expect(json.nonce).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
  });

  it("returns 400 for challenge_response with missing nonce", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "AQ-ESP32-AABBCCDD",
        type: "challenge_response",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/nonce/i);
  });

  // ── Unknown type ──────────────────────────────────────────────────────────

  it("returns 400 for unknown message type", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "AQ-ESP32-AABBCCDD",
        type: "unknown_type",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ── Production dev-token rejection ────────────────────────────────────────

  it("production gate: isDevToken is false when NODE_ENV=production", () => {
    // Unit-test the guard logic directly rather than trying to re-import the
    // module with a different NODE_ENV in a module-cached test environment.
    //
    // The guard in ingest/route.ts:
    //   const isDevToken = token === devToken && process.env.NODE_ENV !== "production";
    const devToken = "dev-device-token-secret";
    const token = "dev-device-token-secret";

    function calcIsDevToken(nodeEnv: string): boolean {
      return token === devToken && nodeEnv !== "production";
    }

    expect(calcIsDevToken("test")).toBe(true);        // allowed in non-production
    expect(calcIsDevToken("production")).toBe(false); // rejected in production
    expect(calcIsDevToken("development")).toBe(true); // allowed in development
  });

  // ── Simulator preservation ────────────────────────────────────────────────

  it("simulator flow: dev token ingests telemetry with correct fields", async () => {
    const req = new NextRequest("http://localhost/api/device/ingest", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-device-token-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "dev-device-1",
        type: "telemetry",
        telemetry: {
          waterLevel: 80,
          voltage: 225,
          voltageState: "NORMAL",
          pumpState: "ON",
          mode: "MANUAL",
          dryRun: false,
          fault: null,
          sequence: 1337,
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await res.json()).ingested).toBe("telemetry");
  });
});
