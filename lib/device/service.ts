/**
 * Device service — the single boundary the PWA talks to.
 *
 * All dashboard / component code calls the functions exported here.
 * The service routes to the active DeviceProvider which may be:
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  Dashboard / UI                                        │
 *   │       ↓                                                │
 *   │  service.ts  (this file — routes to active provider)   │
 *   │       ↓                                                │
 *   │  DeviceProvider                                        │
 *   │       ↓                                                │
 *   │  SimulatorProvider   OR   HardwareProvider              │
 *   │       ↓                        ↓                       │
 *   │  sim-cloud (existing)     DeviceTransport              │
 *   │       ↓                        ↓                       │
 *   │  Simulator engine       Mock / WS / MQTT (future)      │
 *   │                                ↓                       │
 *   │                          ESP32 (future)                │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Default provider is selected by NEXT_PUBLIC_DEVICE_DATA_SOURCE
 * (same as before).  The hidden Connect Mode can swap providers at
 * runtime via setActiveProvider() without reloading the page.
 *
 * PUBLIC API is identical to the previous version — no dashboard
 * component needs to change.
 */

import type { Command, CommandType, DeviceEvent, DeviceState } from "@/types/device";
import type { DataSource } from "@/types/hardware";
import type { DeviceProvider } from "@/lib/device/provider";
import { SimulatorProvider } from "@/lib/device/providers/simulator-provider";
import { createClient } from "@/lib/supabase/client";

// ─── Provider management ─────────────────────────────────────────────────

const DEFAULT_SOURCE: DataSource =
  (process.env.NEXT_PUBLIC_DEVICE_DATA_SOURCE as DataSource | undefined) ?? "simulator";

let activeProvider: DeviceProvider | null = null;

/**
 * Lazily create and return the active provider.
 * Defaults to whatever NEXT_PUBLIC_DEVICE_DATA_SOURCE specifies.
 */
function resolveProvider(): DeviceProvider {
  if (!activeProvider) {
    activeProvider = createDefaultProvider(DEFAULT_SOURCE);
  }
  return activeProvider;
}

function createDefaultProvider(source: DataSource): DeviceProvider {
  if (source === "simulator") {
    const provider = new SimulatorProvider();
    // Auto-start the simulator engine (client-side only)
    if (typeof window !== "undefined") {
      void provider.initialize();
    }
    return provider;
  }

  // For "supabase" source, fall back to the Supabase adapter below.
  // A full SupabaseProvider class could be extracted in the future,
  // but the inline implementation here preserves the existing behaviour
  // exactly and avoids changing anything that already works.
  return createSupabaseFallbackProvider();
}

// ─── Public API (unchanged signatures) ──────────────────────────────────

export async function getDeviceState(deviceId: string): Promise<DeviceState> {
  return resolveProvider().getDeviceState(deviceId);
}

export async function getEvents(deviceId: string): Promise<DeviceEvent[]> {
  return resolveProvider().getEvents(deviceId);
}

export async function createCommand(
  deviceId: string,
  type: CommandType,
): Promise<Command> {
  return resolveProvider().createCommand(deviceId, type);
}

export async function getCommand(
  commandId: string,
): Promise<Command | undefined> {
  return resolveProvider().getCommand(commandId);
}

export function subscribeToDeviceState(
  deviceId: string,
  callback: (state: DeviceState) => void,
): () => void {
  return resolveProvider().subscribeToDeviceState(deviceId, callback);
}

/** Returns whether the current data source is the simulator. */
export function isSimulatorMode(): boolean {
  return resolveProvider().source === "simulator";
}

// ─── Runtime provider management (for Connect Mode) ─────────────────────

/** Get the currently active provider instance. */
export function getActiveProvider(): DeviceProvider {
  return resolveProvider();
}

/** Get the current data source identifier. */
export function getDataSource(): DataSource {
  return resolveProvider().source;
}

/**
 * Swap the active provider at runtime.
 *
 * Used by the hidden Connect Mode to switch between simulator and
 * hardware without a page reload.  The previous provider is disposed.
 */
export function setActiveProvider(provider: DeviceProvider): void {
  if (activeProvider && activeProvider !== provider) {
    activeProvider.dispose?.();
  }
  activeProvider = provider;
}

// ─── Supabase fallback provider ──────────────────────────────────────────
// Wraps the existing Supabase path as a DeviceProvider.  This is a thin
// adapter — the real Supabase queries are preserved exactly as they were.

function createSupabaseFallbackProvider(): DeviceProvider {
  return {
    source: "supabase" as const,

    async getDeviceState(deviceId: string): Promise<DeviceState> {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("device_state")
        .select("*")
        .eq("device_id", deviceId)
        .single();

      if (error || !data) {
        throw new Error(
          `Unable to load device state: ${error?.message ?? "no data"}`,
        );
      }

      return {
        deviceId: data.device_id,
        waterLevel: data.water_level,
        voltage: data.voltage,
        voltageState: data.voltage_state,
        pumpState: data.pump_state,
        mode: data.mode,
        dryRun: data.dry_run,
        fault: data.fault,
        deviceStatus: data.device_status,
        lastSeen: data.last_seen,
        updatedAt: data.updated_at,
        sequence: data.sequence,
      };
    },

    async getEvents(deviceId: string): Promise<DeviceEvent[]> {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("device_id", deviceId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw new Error(`Unable to load events: ${error.message}`);

      return (data ?? []).map((e) => ({
        id: e.id,
        deviceId: e.device_id,
        type: e.type,
        message: e.message,
        createdAt: e.created_at,
      }));
    },

    async createCommand(
      deviceId: string,
      type: CommandType,
    ): Promise<Command> {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, type }),
      });

      if (!res.ok) {
        throw new Error(`Command request failed: ${res.status}`);
      }

      const body = await res.json();
      return {
        id: body.commandId,
        deviceId,
        type,
        status: body.status,
        reason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },

    async getCommand(commandId: string): Promise<Command | undefined> {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("commands")
        .select("*")
        .eq("id", commandId)
        .single();

      if (error || !data) return undefined;

      let status = data.status;
      let reason = data.reason;

      // Client-side safety timeout check (15s)
      if ((status === "PENDING" || status === "RECEIVED") && data.created_at) {
        const createdMs = new Date(data.created_at).getTime();
        if (Date.now() - createdMs > 15000) {
          status = "FAILED";
          reason = "COMMAND_TIMEOUT: Device did not respond within 15s";
        }
      }

      return {
        id: data.id,
        deviceId: data.device_id,
        type: data.type,
        status,
        reason,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },

    subscribeToDeviceState(
      deviceId: string,
      callback: (state: DeviceState) => void,
    ): () => void {
      const supabase = createClient();
      const channel = supabase
        .channel(`device_state:${deviceId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "device_state",
            filter: `device_id=eq.${deviceId}`,
          },
          async () => {
            try {
              const state = await this.getDeviceState(deviceId);
              callback(state);
            } catch {
              // Silently ignore — dashboard will show stale state
            }
          },
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    },

    getConnectionPhase() {
      return "CONNECTED" as const;
    },

    getConnectionStatus() {
      return {
        phase: "CONNECTED" as const,
        dataSource: "supabase" as const,
        esp32: { connected: true },
        stm32: { connected: true },
        telemetry: { receiving: true, messageCount: 0 },
      };
    },

    onConnectionChange() {
      return () => {};
    },
  };
}
