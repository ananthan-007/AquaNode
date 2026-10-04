import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock the Supabase server client (user session check)
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// Mock the Supabase service-role client (DB writes)
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, hasSession = true) {
  // Build a mock server client that returns a user or not
  vi.mocked(createServerClient).mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: {
          user: hasSession ? { id: "user-uuid-1234", email: "dev@example.com" } : null,
        },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);

  // Build a mock service-role client for DB operations
  vi.mocked(createSupabaseClient).mockReturnValue({
    from: (table: string) => {
      if (table === "device_registry") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { device_id: "AQ-ESP32-TESTUNIT", owner_id: null },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "device_tokens") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: "token-uuid-abc",
                  description: "AquaGuard ESP32 - Development Unit 1",
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    },
  } as unknown as ReturnType<typeof createSupabaseClient>);

  return new NextRequest(
    "http://localhost/api/admin/provision-device-token",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/admin/provision-device-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role";
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when no user session", async () => {
    const { POST } = await import("../route");
    const req = makeRequest({ registryDeviceId: "AQ-ESP32-TESTUNIT" }, false);
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/authentication/i);
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it("returns 400 when registryDeviceId is missing", async () => {
    const { POST } = await import("../route");
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/registryDeviceId/i);
  });

  it("returns 400 when registryDeviceId is an empty string", async () => {
    const { POST } = await import("../route");
    const req = makeRequest({ registryDeviceId: "  " });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is not JSON", async () => {
    vi.mocked(createServerClient).mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-1" } },
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createServerClient>>);

    vi.mocked(createSupabaseClient).mockReturnValue(
      {} as unknown as ReturnType<typeof createSupabaseClient>,
    );

    const { POST } = await import("../route");
    const req = new NextRequest(
      "http://localhost/api/admin/provision-device-token",
      { method: "POST", body: "not-json" },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ── Success ───────────────────────────────────────────────────────────────

  it("returns 200 with rawToken on success", async () => {
    const { POST } = await import("../route");
    const req = makeRequest({
      registryDeviceId: "AQ-ESP32-TESTUNIT",
      description: "Bench test unit",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.rawToken).toBe("string");
    expect(json.rawToken.length).toBe(64);
    expect(json.rawToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("response includes tokenId, registryDeviceId, instructions", async () => {
    const { POST } = await import("../route");
    const req = makeRequest({ registryDeviceId: "AQ-ESP32-TESTUNIT" });
    const res = await POST(req);
    const json = await res.json();
    expect(json.tokenId).toBe("token-uuid-abc");
    expect(json.registryDeviceId).toBe("AQ-ESP32-TESTUNIT");
    expect(Array.isArray(json.instructions)).toBe(true);
    expect(json.instructions.length).toBeGreaterThan(0);
  });

  it("rawToken is different on every call (cryptographically random)", async () => {
    const { POST } = await import("../route");
    const req1 = makeRequest({ registryDeviceId: "AQ-ESP32-TESTUNIT" });
    const req2 = makeRequest({ registryDeviceId: "AQ-ESP32-TESTUNIT" });
    const [res1, res2] = await Promise.all([POST(req1), POST(req2)]);
    const [j1, j2] = await Promise.all([res1.json(), res2.json()]);
    expect(j1.rawToken).not.toBe(j2.rawToken);
  });

  it("response does not contain a token_hash field (hash is never returned)", async () => {
    const { POST } = await import("../route");
    const req = makeRequest({ registryDeviceId: "AQ-ESP32-TESTUNIT" });
    const res = await POST(req);
    const json = await res.json() as Record<string, unknown>;
    // The hash (which would allow offline lookup attacks) must never be
    // returned. Only the rawToken is returned, and only once.
    expect(json).not.toHaveProperty("tokenHash");
    expect(json).not.toHaveProperty("token_hash");
    expect(json).not.toHaveProperty("hash");
  });
});

// ─── Token security properties ────────────────────────────────────────────────

describe("Token security properties", () => {
  it("hashDeviceToken output never equals the input (no identity hash)", async () => {
    const { hashDeviceToken, generateDeviceToken } = await import(
      "@/lib/device/token-auth"
    );
    for (let i = 0; i < 5; i++) {
      const raw = generateDeviceToken();
      expect(hashDeviceToken(raw)).not.toBe(raw);
    }
  });

  it("production route stores hash, not raw token, in DB", async () => {
    // Verify the provisioning route calls hashDeviceToken before inserting.
    // We do this by confirming the inserted token_hash is NOT equal to rawToken.
    const insertedValues: Record<string, unknown>[] = [];

    vi.mocked(createServerClient).mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: { id: "u1" } } }),
      },
    } as unknown as Awaited<ReturnType<typeof createServerClient>>);

    vi.mocked(createSupabaseClient).mockReturnValue({
      from: (table: string) => {
        if (table === "device_registry") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { device_id: "AQ-ESP32-X", owner_id: null },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "device_tokens") {
          return {
            insert: (values: Record<string, unknown>) => {
              insertedValues.push(values);
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: "tok-1", description: "test", created_at: "" },
                    error: null,
                  }),
                }),
              };
            },
          };
        }
        return {};
      },
    } as unknown as ReturnType<typeof createSupabaseClient>);

    const { POST } = await import("../route");
    const req = new NextRequest(
      "http://localhost/api/admin/provision-device-token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registryDeviceId: "AQ-ESP32-X" }),
      },
    );

    const res = await POST(req);
    const json = await res.json() as { rawToken: string };

    expect(insertedValues.length).toBeGreaterThan(0);
    const inserted = insertedValues[0] as Record<string, unknown>;
    // token_hash must be the hash, not the raw token
    expect(inserted["token_hash"]).not.toBe(json.rawToken);
    // token_hash must look like a SHA-256 hex digest
    expect(String(inserted["token_hash"])).toMatch(/^[0-9a-f]{64}$/);
  });
});
