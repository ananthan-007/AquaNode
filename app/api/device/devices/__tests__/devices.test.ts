import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { calculateDeviceStatus } from "../route";
import { HEARTBEAT_ONLINE_MS, HEARTBEAT_OFFLINE_MS } from "@/lib/device/constants";

// Hoisted to top level to avoid vitest warning
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
}));

// ─── calculateDeviceStatus unit tests ────────────────────────────────────────

describe("calculateDeviceStatus", () => {
  it("returns ONLINE when last_seen is within HEARTBEAT_ONLINE_MS", () => {
    const now = Date.now();
    const lastSeen = new Date(now - HEARTBEAT_ONLINE_MS + 1_000).toISOString();
    expect(calculateDeviceStatus(lastSeen, now)).toBe("ONLINE");
  });

  it("returns ONLINE exactly at HEARTBEAT_ONLINE_MS boundary", () => {
    const now = Date.now();
    const lastSeen = new Date(now - HEARTBEAT_ONLINE_MS).toISOString();
    expect(calculateDeviceStatus(lastSeen, now)).toBe("ONLINE");
  });

  it("returns STALE just after HEARTBEAT_ONLINE_MS", () => {
    const now = Date.now();
    const lastSeen = new Date(now - HEARTBEAT_ONLINE_MS - 1).toISOString();
    expect(calculateDeviceStatus(lastSeen, now)).toBe("STALE");
  });

  it("returns STALE exactly at HEARTBEAT_OFFLINE_MS", () => {
    const now = Date.now();
    const lastSeen = new Date(now - HEARTBEAT_OFFLINE_MS).toISOString();
    expect(calculateDeviceStatus(lastSeen, now)).toBe("STALE");
  });

  it("returns OFFLINE just after HEARTBEAT_OFFLINE_MS", () => {
    const now = Date.now();
    const lastSeen = new Date(now - HEARTBEAT_OFFLINE_MS - 1).toISOString();
    expect(calculateDeviceStatus(lastSeen, now)).toBe("OFFLINE");
  });

  it("returns OFFLINE for a device silent for 5 minutes", () => {
    const now = Date.now();
    expect(calculateDeviceStatus(new Date(now - 300_000).toISOString(), now)).toBe("OFFLINE");
  });

  it("returns OFFLINE for invalid ISO string", () => {
    expect(calculateDeviceStatus("not-a-date")).toBe("OFFLINE");
  });

  it("returns OFFLINE for empty string", () => {
    expect(calculateDeviceStatus("")).toBe("OFFLINE");
  });

  it("3 missed heartbeats at 8 s each (24 s) → still ONLINE with tolerant threshold", () => {
    // HEARTBEAT_ONLINE_MS defaults to 25 s — 3 × 8 s = 24 s must remain ONLINE.
    const now = Date.now();
    expect(calculateDeviceStatus(new Date(now - 24_000).toISOString(), now)).toBe("ONLINE");
  });
});

// ─── GET /api/device/devices route tests ─────────────────────────────────────

describe("GET /api/device/devices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";
  });

  it("returns empty devices array when no rows exist", async () => {
    const { GET } = await import("../route");
    const req = new NextRequest("http://localhost/api/device/devices");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.devices).toEqual([]);
  });

  it("boundary: HEARTBEAT_ONLINE_MS + 1 → STALE, not ONLINE", () => {
    const now = Date.now();
    expect(
      calculateDeviceStatus(new Date(now - HEARTBEAT_ONLINE_MS - 1).toISOString(), now),
    ).toBe("STALE");
  });

  it("boundary: HEARTBEAT_OFFLINE_MS + 1 → OFFLINE, not STALE", () => {
    const now = Date.now();
    expect(
      calculateDeviceStatus(new Date(now - HEARTBEAT_OFFLINE_MS - 1).toISOString(), now),
    ).toBe("OFFLINE");
  });
});
