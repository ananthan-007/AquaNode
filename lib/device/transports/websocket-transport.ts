/**
 * WebSocketTransport — real hardware transport that connects to the
 * AquaGuard backend via WebSocket.
 *
 * Architecture:
 *   HardwareProvider
 *        ↓
 *   DeviceTransport  ← WebSocketTransport implements this
 *        ↓
 *   WebSocket connection
 *        ↓
 *   Backend / Cloud API
 *        ↓
 *   ESP32 → UART → STM32
 *
 * CRITICAL: This transport connects to a REAL endpoint.
 * If no backend / device is reachable, connection FAILS honestly.
 * No fake connections, no mock data, no simulated handshakes.
 *
 * The transport transitions to CONNECTED only when:
 *   1. A real WebSocket connection is successfully established
 *   2. The underlying TCP connection is open and verified
 *
 * ESP32 / STM32 / telemetry status is NOT determined here — that is
 * the HardwareProvider's responsibility based on actual inbound
 * `device_status` and `telemetry` messages from the real device.
 */

import type { DeviceTransport } from "@/lib/device/transport";
import type {
  ConnectionPhase,
  HardwareInboundMessage,
  HardwareOutboundMessage,
} from "@/types/hardware";
import { isValidInboundMessage } from "@/types/hardware";

// ─── Configuration ───────────────────────────────────────────────────────

interface WebSocketTransportConfig {
  /** Timeout for initial WebSocket connection (ms). Default 10s. */
  connectTimeoutMs: number;
}

const DEFAULT_CONFIG: WebSocketTransportConfig = {
  connectTimeoutMs: 10_000,
};

// ─── Types ───────────────────────────────────────────────────────────────

type MessageHandler = (msg: HardwareInboundMessage) => void;
type ConnectionHandler = (phase: ConnectionPhase) => void;

// ─── Transport ───────────────────────────────────────────────────────────

export class WebSocketTransport implements DeviceTransport {
  readonly name = "websocket";

  private _phase: ConnectionPhase = "DISCONNECTED";
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly config: WebSocketTransportConfig;

  private messageHandlers = new Set<MessageHandler>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, config?: Partial<WebSocketTransportConfig>) {
    this.url = url;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get connectionPhase(): ConnectionPhase {
    return this._phase;
  }

  // ── Connection lifecycle ──────────────────────────────────────────────

  async connect(deviceId: string): Promise<void> {
    if (this._phase === "CONNECTED" || this._phase === "CONNECTING") return;

    return new Promise<void>((resolve, reject) => {
      this.setPhase("CONNECTING");

      // Build URL with device ID query parameter
      const separator = this.url.includes("?") ? "&" : "?";
      const wsUrl = `${this.url}${separator}deviceId=${encodeURIComponent(deviceId)}`;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (error) {
        this.setPhase("ERROR");
        reject(
          new Error(
            `Invalid WebSocket URL: ${this.url} — ${error instanceof Error ? error.message : "unknown error"}`,
          ),
        );
        return;
      }

      this.ws = ws;
      let settled = false;

      const settle = (
        outcome: "resolve" | "reject",
        reason?: string,
      ): void => {
        if (settled) return;
        settled = true;
        this.clearConnectTimer();

        if (outcome === "resolve") {
          resolve();
        } else {
          reject(new Error(reason ?? "Connection failed"));
        }
      };

      // Connection timeout — if the server doesn't respond, fail honestly
      this.connectTimer = setTimeout(() => {
        this.connectTimer = null;
        if (this._phase === "CONNECTING") {
          ws.close();
          this.ws = null;
          this.setPhase("ERROR");
          settle(
            "reject",
            `Connection timed out after ${this.config.connectTimeoutMs}ms — no device found at ${this.url}`,
          );
        }
      }, this.config.connectTimeoutMs);

      ws.onopen = () => {
        // The WebSocket TCP connection is open.
        // This does NOT mean ESP32/STM32 are connected — only that
        // the transport channel to the backend is operational.
        this.setPhase("CONNECTED");
        settle("resolve");
      };

      ws.onerror = () => {
        // The WebSocket onerror event doesn't provide useful error
        // information per spec.  The onclose handler fires immediately
        // after with more detail, so we defer rejection there.
      };

      ws.onclose = (event) => {
        this.clearConnectTimer();
        const wasConnecting = this._phase === "CONNECTING";
        this.ws = null;

        if (wasConnecting) {
          this.setPhase("ERROR");
          settle(
            "reject",
            `Connection failed: ${event.reason || "server unreachable or refused connection"} (code ${event.code})`,
          );
        } else if (this._phase === "CONNECTED") {
          // Connection was open and dropped — transport error
          this.setPhase("ERROR");
        } else {
          this.setPhase("DISCONNECTED");
        }
      };

      ws.onmessage = (event) => {
        try {
          const data =
            typeof event.data === "string"
              ? (JSON.parse(event.data) as unknown)
              : null;

          if (data && isValidInboundMessage(data)) {
            this.emitMessage(data);
          } else {
            console.warn(
              "[WebSocketTransport] Dropped invalid message:",
              data,
            );
          }
        } catch {
          console.warn(
            "[WebSocketTransport] Failed to parse message:",
            event.data,
          );
        }
      };
    });
  }

  async disconnect(): Promise<void> {
    this.clearConnectTimer();

    if (this.ws) {
      // Remove event handlers before close to avoid triggering
      // the error phase from the onclose callback
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;

      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close(1000, "Client disconnect");
      }
      this.ws = null;
    }

    this.setPhase("DISCONNECTED");
  }

  // ── Messaging ─────────────────────────────────────────────────────────

  send(message: HardwareOutboundMessage): void {
    if (this._phase !== "CONNECTED" || !this.ws) {
      throw new Error(
        `Cannot send: transport is ${this._phase} (no active connection)`,
      );
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        `Cannot send: WebSocket readyState is ${this.ws.readyState}`,
      );
    }

    this.ws.send(JSON.stringify(message));
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  private setPhase(phase: ConnectionPhase): void {
    if (this._phase === phase) return;
    this._phase = phase;
    for (const handler of this.connectionHandlers) {
      try {
        handler(phase);
      } catch {
        // Never let a handler error crash the transport
      }
    }
  }

  private emitMessage(msg: HardwareInboundMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch {
        // Never let a handler error crash the transport
      }
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }
}
