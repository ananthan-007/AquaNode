/**
 * CloudTransport — Vercel-compatible hardware transport that connects
 * to the AquaGuard cloud backend via REST & Supabase Realtime.
 *
 * Architecture:
 *   HardwareProvider → CloudTransport → Next.js Backend APIs / Supabase Realtime
 *                                              ↓
 *                                            ESP32 → UART → STM32
 *
 * This transport satisfies the Vercel serverless environment requirements.
 * No direct browser-to-ESP32 LAN access (192.168.x.x) or persistent WebSockets
 * inside Vercel are required.
 */

import type { DeviceTransport } from "@/lib/device/transport";
import type {
  ConnectionPhase,
  HardwareInboundMessage,
  HardwareOutboundMessage,
} from "@/types/hardware";
import {
  HEARTBEAT_ONLINE_MS,
  HEARTBEAT_OFFLINE_MS,
  CHALLENGE_POLL_TIMEOUT_MS,
  CHALLENGE_POLL_INTERVAL_MS,
} from "@/lib/device/constants";

interface CloudTransportConfig {
  /** Polling interval (ms) for device state updates. Default 2000ms. */
  pollIntervalMs: number;
}

const DEFAULT_CONFIG: CloudTransportConfig = {
  pollIntervalMs: 2000,
};

type MessageHandler = (msg: HardwareInboundMessage) => void;
type ConnectionHandler = (phase: ConnectionPhase) => void;

export class CloudTransport implements DeviceTransport {
  readonly name = "cloud";

  private _phase: ConnectionPhase = "DISCONNECTED";
  private deviceId: string | null = null;
  private readonly config: CloudTransportConfig;

  private messageHandlers = new Set<MessageHandler>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<CloudTransportConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get connectionPhase(): ConnectionPhase {
    return this._phase;
  }

  async connect(deviceId: string): Promise<void> {
    if (this._phase === "CONNECTED" || this._phase === "CONNECTING") return;

    this.setPhase("CONNECTING");
    this.deviceId = deviceId;

    try {
      // ── Phase 1: DB pre-check + challenge issuance ────────────────────────
      const res = await fetch("/api/device/handshake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(
          String(errorData["error"] ?? `Handshake failed with status ${res.status}`),
        );
      }
      const handshakeResult = await res.json() as {
        success: boolean;
        challengeIssued: boolean;
        challengeId: string | null;
        verified: boolean;
        esp32Connected: boolean;
        stm32Connected: boolean;
        telemetryReceiving: boolean;
        firmwareVersion: string;
        deviceState?: Record<string, unknown>;
        lastSeen: string;
        error?: string;
      };

      if (!handshakeResult.esp32Connected) {
        throw new Error(
          handshakeResult.error ??
            `Device '${deviceId}' is OFFLINE — no recent heartbeats`,
        );
      }

      // ── Phase 2: Live challenge/response ──────────────────────────────────
      // If the backend issued a challenge nonce, poll /handshake/verify until
      // the ESP32 echoes it back. This proves the device is live right now.
      let finallyVerified = handshakeResult.verified; // true only if migration 0005 not applied

      if (handshakeResult.challengeIssued && handshakeResult.challengeId) {
        finallyVerified = await this.pollChallengeVerify(
          handshakeResult.challengeId,
        );
        if (!finallyVerified) {
          throw new Error(
            "Live challenge failed — ESP32 did not respond to the nonce in time. " +
              "Ensure the device is powered, connected to Wi-Fi, and polling the backend.",
          );
        }
      }

      this.setPhase("CONNECTED");

      // Emit initial hardware status from the handshake result
      this.emitMessage({
        type: "device_status",
        deviceId,
        esp32: {
          connected: handshakeResult.esp32Connected,
          firmwareVersion: handshakeResult.firmwareVersion,
        },
        stm32: { connected: handshakeResult.stm32Connected },
        timestamp: new Date().toISOString(),
      });

      if (handshakeResult.deviceState) {
        this.emitMessage({
          type: "telemetry",
          // DeviceState shape comes directly from the handshake result;
          // cast via unknown since the JSON response is untyped at this layer.
          payload: handshakeResult.deviceState as unknown as import("@/types/device").DeviceState,
          timestamp: new Date().toISOString(),
        });
      }

      this.startPolling();
    } catch (err) {
      this.setPhase("ERROR");
      throw err;
    }
  }

  /**
   * Poll GET /api/device/handshake/verify until the ESP32 echoes the nonce
   * or the timeout elapses.
   * Returns true if the challenge was responded to, false on timeout/expiry.
   */
  private async pollChallengeVerify(challengeId: string): Promise<boolean> {
    const deadline = Date.now() + CHALLENGE_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, CHALLENGE_POLL_INTERVAL_MS));

      try {
        const res = await fetch(
          `/api/device/handshake/verify?challengeId=${encodeURIComponent(challengeId)}`,
        );
        if (!res.ok) return false;

        const data = await res.json() as {
          verified?: boolean;
          expired?: boolean;
          pending?: boolean;
        };

        if (data.verified) return true;
        if (data.expired) return false;
        // data.pending → keep polling
      } catch {
        // transient fetch error — keep trying until deadline
      }
    }

    return false; // timed out on our side
  }

  async disconnect(): Promise<void> {
    this.stopPolling();
    this.deviceId = null;
    this.setPhase("DISCONNECTED");
  }

  send(message: HardwareOutboundMessage): void {
    if (this._phase !== "CONNECTED" || !this.deviceId) {
      throw new Error(`Cannot send message: transport is ${this._phase}`);
    }

    if (message.type === "command") {
      void fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: message.deviceId,
          type: message.command,
        }),
      }).catch((err) => {
        console.error("[CloudTransport] Command dispatch error:", err);
      });
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      void this.pollDeviceState();
    }, this.config.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollDeviceState(): Promise<void> {
    if (!this.deviceId || this._phase === "DISCONNECTED") return;

    try {
      const res = await fetch(`/api/device/${encodeURIComponent(this.deviceId)}`);
      if (!res.ok) return;

      const data = await res.json();
      if (!data.deviceState) return;

      const state = data.deviceState;
      const nowMs = Date.now();
      const lastSeenMs = new Date(state.last_seen || state.updated_at).getTime();
      const ageMs = nowMs - lastSeenMs;

      const isEsp32Online = ageMs <= HEARTBEAT_ONLINE_MS;
      const isEsp32Reachable = ageMs <= HEARTBEAT_OFFLINE_MS;

      if (!isEsp32Online && !isEsp32Reachable) {
        // Device is OFFLINE (beyond HEARTBEAT_OFFLINE_MS)
        this.emitMessage({
          type: "device_status",
          deviceId: this.deviceId,
          esp32: { connected: false, firmwareVersion: state.firmware_version },
          stm32: { connected: false },
          timestamp: new Date().toISOString(),
        });
        if (this._phase === "CONNECTED") {
          this.setPhase("STALE");
        }
        return;
      }

      // Update hardware status (ONLINE or STALE — both reachable)
      const stm32Connected = Boolean(state.stm32_connected);
      this.emitMessage({
        type: "device_status",
        deviceId: this.deviceId,
        esp32: { connected: true, firmwareVersion: state.firmware_version },
        stm32: { connected: stm32Connected },
        timestamp: new Date().toISOString(),
      });

      // Emit telemetry
      this.emitMessage({
        type: "telemetry",
        payload: {
          deviceId: state.device_id,
          waterLevel: state.water_level,
          voltage: Number(state.voltage),
          voltageState: state.voltage_state,
          pumpState: state.pump_state,
          mode: state.mode,
          dryRun: state.dry_run,
          fault: state.fault,
          deviceStatus: isEsp32Online ? "ONLINE" : "OFFLINE",
          lastSeen: state.last_seen,
          updatedAt: state.updated_at,
          sequence: Number(state.sequence),
          firmwareVersion: state.firmware_version,
          stm32Connected,
          lastTelemetryAt: state.last_telemetry_at,
        },
        timestamp: state.updated_at || new Date().toISOString(),
      });

      if (isEsp32Online && this._phase === "STALE") {
        this.setPhase("CONNECTED");
      }
    } catch {
      // Ignore transient polling errors
    }
  }

  private setPhase(phase: ConnectionPhase): void {
    if (this._phase === phase) return;
    this._phase = phase;
    for (const handler of this.connectionHandlers) {
      try {
        handler(phase);
      } catch {
        // Ignore
      }
    }
  }

  private emitMessage(msg: HardwareInboundMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch {
        // Ignore
      }
    }
  }
}
