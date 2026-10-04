/**
 * MockHardwareTransport — a realistic mock of a hardware transport
 * for testing the HardwareProvider without a physical ESP32.
 *
 * Architecture:
 *   HardwareProvider
 *        ↓
 *   DeviceTransport  ← MockHardwareTransport implements this
 *        ↓
 *   (simulated backend — generates fake telemetry, processes commands)
 *
 * Supports testing:
 *   ✓ Successful connection        ✓ Connection failure
 *   ✓ Delayed connection           ✓ Telemetry streaming
 *   ✓ Telemetry stopping           ✓ Stale connection
 *   ✓ Disconnect                   ✓ Reconnect
 *   ✓ Command success              ✓ Command rejection
 *   ✓ Command failure              ✓ Malformed messages
 */

import type { DeviceTransport } from "@/lib/device/transport";
import type {
  ConnectionPhase,
  HardwareInboundMessage,
  HardwareOutboundMessage,
} from "@/types/hardware";
import type { DeviceState } from "@/types/device";

// ─── Configuration ───────────────────────────────────────────────────────

export interface MockTransportConfig {
  /** Delay before connection resolves (ms). */
  connectDelayMs: number;
  /** If true, connect() will reject. */
  connectShouldFail: boolean;
  /** Interval for telemetry messages (ms). 0 = no telemetry. */
  telemetryIntervalMs: number;
  /** Delay before command ack (ms). */
  commandAckDelayMs: number;
  /**
   * How commands are resolved:
   *   "success"  → RECEIVED then EXECUTED
   *   "reject"   → RECEIVED then REJECTED
   *   "fail"     → RECEIVED then FAILED
   *   "timeout"  → RECEIVED but never resolves
   */
  commandOutcome: "success" | "reject" | "fail" | "timeout";
  /** If true, injects malformed messages into the stream. */
  injectMalformed: boolean;
  /** Heartbeat interval (ms). 0 = no heartbeats. */
  heartbeatIntervalMs: number;
}

const DEFAULT_CONFIG: MockTransportConfig = {
  connectDelayMs: 300,
  connectShouldFail: false,
  telemetryIntervalMs: 2000,
  commandAckDelayMs: 500,
  commandOutcome: "success",
  injectMalformed: false,
  heartbeatIntervalMs: 10000,
};

// ─── Mock Device State ───────────────────────────────────────────────────

function createMockDeviceState(deviceId: string, sequence: number): DeviceState {
  return {
    deviceId,
    waterLevel: 50 + Math.sin(sequence * 0.1) * 20,
    voltage: 230 + (Math.random() - 0.5) * 8,
    voltageState: "NORMAL",
    pumpState: "OFF",
    mode: "AUTO",
    dryRun: false,
    fault: null,
    deviceStatus: "ONLINE",
    lastSeen: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sequence,
  };
}

// ─── Transport Implementation ────────────────────────────────────────────

type MessageHandler = (msg: HardwareInboundMessage) => void;
type ConnectionHandler = (phase: ConnectionPhase) => void;

export class MockHardwareTransport implements DeviceTransport {
  readonly name = "mock-hardware";

  private _phase: ConnectionPhase = "DISCONNECTED";
  private config: MockTransportConfig;
  private deviceId: string | null = null;
  private sequence = 0;

  private messageHandlers = new Set<MessageHandler>();
  private connectionHandlers = new Set<ConnectionHandler>();

  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

  constructor(config?: Partial<MockTransportConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get connectionPhase(): ConnectionPhase {
    return this._phase;
  }

  // ── Connection lifecycle ──────────────────────────────────────────────

  async connect(deviceId: string): Promise<void> {
    if (this._phase === "CONNECTED" || this._phase === "CONNECTING") return;

    this.deviceId = deviceId;
    this.setPhase("CONNECTING");

    await this.delay(this.config.connectDelayMs);

    if (this.config.connectShouldFail) {
      this.setPhase("ERROR");
      throw new Error("Mock connection failed: simulated connection failure");
    }

    this.setPhase("CONNECTED");

    // Send initial device status
    this.emit({
      type: "device_status",
      deviceId,
      esp32: { connected: true, firmwareVersion: "mock-1.0.0" },
      stm32: { connected: true, lastComm: new Date().toISOString() },
      timestamp: new Date().toISOString(),
    });

    // Start telemetry stream
    if (this.config.telemetryIntervalMs > 0) {
      this.telemetryTimer = setInterval(() => {
        if (this._phase !== "CONNECTED") return;
        this.sequence++;
        this.emit({
          type: "telemetry",
          payload: createMockDeviceState(deviceId, this.sequence),
          timestamp: new Date().toISOString(),
        });

        // Optionally inject malformed messages
        if (this.config.injectMalformed && this.sequence % 5 === 0) {
          this.emit({ type: "GARBAGE_TYPE" } as unknown as HardwareInboundMessage);
        }
      }, this.config.telemetryIntervalMs);
    }

    // Start heartbeat
    if (this.config.heartbeatIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        if (this._phase !== "CONNECTED") return;
        this.emit({
          type: "heartbeat",
          deviceId,
          uptimeMs: this.sequence * this.config.telemetryIntervalMs,
          timestamp: new Date().toISOString(),
        });
      }, this.config.heartbeatIntervalMs);
    }
  }

  async disconnect(): Promise<void> {
    this.cleanup();
    this.setPhase("DISCONNECTED");
  }

  // ── Messaging ─────────────────────────────────────────────────────────

  send(message: HardwareOutboundMessage): void {
    if (this._phase !== "CONNECTED") {
      throw new Error(`Cannot send: transport is ${this._phase}`);
    }

    if (message.type === "command") {
      this.processCommand(message.commandId, message.command);
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

  // ── Runtime configuration (for test control) ──────────────────────────

  /** Update config at runtime (e.g., to switch command outcomes mid-test). */
  updateConfig(partial: Partial<MockTransportConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /** Simulate the transport going stale (telemetry stops arriving). */
  simulateStale(): void {
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    this.setPhase("STALE");
  }

  /** Simulate a transport-level error (connection drops). */
  simulateError(reason?: string): void {
    this.cleanup();
    this.setPhase("ERROR");
    // Emit a status message to inform the provider
    if (this.deviceId) {
      this.emit({
        type: "device_status",
        deviceId: this.deviceId,
        esp32: { connected: false },
        stm32: { connected: false },
        timestamp: new Date().toISOString(),
      });
    }
    void reason; // available for future error reporting
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  private processCommand(commandId: string, commandType: string): void {
    void commandType;
    const ackDelay = this.config.commandAckDelayMs;

    // Phase 1: RECEIVED
    const t1 = setTimeout(() => {
      this.pendingTimeouts.delete(t1);
      this.emit({
        type: "command_result",
        commandId,
        status: "RECEIVED",
        timestamp: new Date().toISOString(),
      });

      if (this.config.commandOutcome === "timeout") return;

      // Phase 2: Terminal status
      const t2 = setTimeout(() => {
        this.pendingTimeouts.delete(t2);
        const outcome = this.config.commandOutcome;
        this.emit({
          type: "command_result",
          commandId,
          status: outcome === "success" ? "EXECUTED" : outcome === "reject" ? "REJECTED" : "FAILED",
          reason: outcome === "reject" ? "Safety check failed (mock)" : outcome === "fail" ? "Hardware error (mock)" : undefined,
          timestamp: new Date().toISOString(),
        });
      }, ackDelay);
      this.pendingTimeouts.add(t2);
    }, ackDelay);
    this.pendingTimeouts.add(t1);
  }

  private emit(msg: HardwareInboundMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch {
        // Never let a handler error crash the transport
      }
    }
  }

  private setPhase(phase: ConnectionPhase): void {
    this._phase = phase;
    for (const handler of this.connectionHandlers) {
      try {
        handler(phase);
      } catch {
        // Never let a handler error crash the transport
      }
    }
  }

  private cleanup(): void {
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const t of this.pendingTimeouts) {
      clearTimeout(t);
    }
    this.pendingTimeouts.clear();
    this.sequence = 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.pendingTimeouts.delete(t);
        resolve();
      }, ms);
      this.pendingTimeouts.add(t);
    });
  }
}
