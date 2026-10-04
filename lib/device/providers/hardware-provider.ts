/**
 * HardwareProvider — device provider for real ESP32 hardware.
 *
 * Uses a DeviceTransport to communicate with the device backend.
 * In production: WebSocketTransport connects to the real backend.
 * In tests: MockHardwareTransport simulates the transport layer.
 *
 * Architecture (real hardware path):
 *   Dashboard → service.ts → HardwareProvider (this)
 *                                   ↓
 *                             DeviceTransport
 *                                   ↓
 *                          WebSocketTransport
 *                                   ↓
 *                          Backend / Cloud API
 *                                   ↓
 *                                 ESP32
 *                                   ↓  UART
 *                                 STM32
 *                                   ↓
 *                        Sensors + Pump + Safety Logic
 *
 * CRITICAL RULES:
 *   - ESP32 is only "connected" when the device sends a device_status
 *     message confirming it.  Never assume connected without proof.
 *   - STM32 is only "connected" when ESP32 explicitly reports it.
 *   - Telemetry is only "receiving" after real telemetry packets arrive.
 *   - Commands are REQUESTS until hardware confirms (EXECUTED / REJECTED / FAILED).
 *   - Pump state is NEVER optimistically updated.
 *   - STM32 / hardware has final safety authority.
 *   - Connection loss never falsely shows successful hardware control.
 *   - No physical connection + no verified handshake = NEVER display Connected.
 */

import type { Command, CommandType, DeviceEvent, DeviceState } from "@/types/device";
import type {
  ConnectionPhase,
  HardwareConnectionStatus,
  HardwareInboundMessage,
} from "@/types/hardware";
import { defaultConnectionStatus, isValidInboundMessage } from "@/types/hardware";
import type { DeviceProvider } from "@/lib/device/provider";
import type { DeviceTransport } from "@/lib/device/transport";

// ─── Configuration ───────────────────────────────────────────────────────

interface HardwareProviderConfig {
  /** Max time without telemetry before declaring STALE (ms). */
  staleTimeoutMs: number;
  /** Max time without any message before declaring ERROR (ms). */
  errorTimeoutMs: number;
  /** Delay before auto-reconnect after error (ms). */
  reconnectDelayMs: number;
  /** Max reconnect attempts before giving up. 0 = unlimited. */
  maxReconnectAttempts: number;
}

const DEFAULT_CONFIG: HardwareProviderConfig = {
  staleTimeoutMs: 30_000,
  errorTimeoutMs: 90_000,
  reconnectDelayMs: 5_000,
  maxReconnectAttempts: 10,
};

// ─── Types ───────────────────────────────────────────────────────────────

type StateListener = (state: DeviceState) => void;
type ConnectionChangeHandler = (phase: ConnectionPhase) => void;

// ─── Provider ────────────────────────────────────────────────────────────

export class HardwareProvider implements DeviceProvider {
  readonly source = "hardware" as const;

  private transport: DeviceTransport;
  private config: HardwareProviderConfig;
  private deviceId: string | null = null;

  // State stores (populated from inbound messages)
  private latestState: DeviceState | null = null;
  private commands = new Map<string, Command>();
  private events: DeviceEvent[] = [];

  // Connection tracking
  private status: HardwareConnectionStatus;
  private lastMessageTime = 0;
  private stalenessTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  // Listeners
  private stateListeners = new Set<StateListener>();
  private connectionListeners = new Set<ConnectionChangeHandler>();

  // Cleanup tracking
  private transportUnsubs: (() => void)[] = [];
  private disposed = false;

  constructor(transport: DeviceTransport, config?: Partial<HardwareProviderConfig>) {
    this.transport = transport;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.status = defaultConnectionStatus("hardware");
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.disposed) return;

    // Listen to transport messages
    this.transportUnsubs.push(
      this.transport.onMessage((msg) => this.handleInboundMessage(msg)),
    );
    this.transportUnsubs.push(
      this.transport.onConnectionChange((phase) => this.handleTransportPhaseChange(phase)),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Disconnect transport
    void this.transport.disconnect().catch(() => {});

    // Clear all timers
    if (this.stalenessTimer) {
      clearInterval(this.stalenessTimer);
      this.stalenessTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Unsubscribe from transport
    for (const unsub of this.transportUnsubs) {
      unsub();
    }
    this.transportUnsubs = [];

    // Clear listeners
    this.stateListeners.clear();
    this.connectionListeners.clear();

    // Clear state
    this.commands.clear();
    this.events = [];
    this.latestState = null;

    this.updatePhase("DISCONNECTED");
  }

  // ── Connection management (exposed for Connect Mode) ──────────────────

  /** Attempt to connect to a device via the transport. */
  async connect(deviceId: string): Promise<void> {
    if (this.disposed) throw new Error("Provider has been disposed");
    this.deviceId = deviceId;
    this.reconnectAttempts = 0;

    // Reset ALL hardware status for a fresh connection attempt.
    // No stale data from previous connections must leak through.
    this.status.esp32 = { connected: false };
    this.status.stm32 = { connected: false };
    this.status.telemetry = { receiving: false, messageCount: 0 };
    this.status.error = undefined;
    this.latestState = null;

    try {
      await this.transport.connect(deviceId);

      // Send handshake to identify this client to the backend / ESP32.
      // The backend uses this to route device data to us.
      try {
        this.transport.send({
          type: "handshake",
          deviceId,
          clientVersion: "1.0.0",
        });
      } catch {
        // Handshake send failure is non-fatal — the transport may
        // handle identification via the connection URL instead.
      }

      this.startStalenessMonitor();
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : "Connection failed";
      this.updatePhase("ERROR");
      throw error;
    }
  }

  /** Disconnect from the device. */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stalenessTimer) {
      clearInterval(this.stalenessTimer);
      this.stalenessTimer = null;
    }
    await this.transport.disconnect();

    // Reset all hardware status — no connection = nothing connected.
    // This ensures we never display stale "Connected" after disconnect.
    this.status.esp32 = { connected: false };
    this.status.stm32 = { connected: false };
    this.status.telemetry = { receiving: false, messageCount: 0 };
    this.status.error = undefined;
    this.latestState = null;

    this.updatePhase("DISCONNECTED");
  }

  // ── Core data operations ──────────────────────────────────────────────

  async getDeviceState(deviceId: string): Promise<DeviceState> {
    if (!this.latestState || this.latestState.deviceId !== deviceId) {
      throw new Error(
        this.status.phase === "CONNECTED"
          ? "Waiting for first telemetry from device"
          : `Hardware not connected (${this.status.phase})`,
      );
    }
    return this.latestState;
  }

  async getEvents(deviceId: string): Promise<DeviceEvent[]> {
    return this.events
      .filter((e) => e.deviceId === deviceId)
      .slice()
      .reverse()
      .slice(0, 50);
  }

  async createCommand(deviceId: string, type: CommandType): Promise<Command> {
    if (this.status.phase !== "CONNECTED") {
      throw new Error(`Cannot send command: hardware is ${this.status.phase}`);
    }

    const commandId = `hw-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const command: Command = {
      id: commandId,
      deviceId,
      type,
      status: "PENDING",
      reason: null,
      createdAt: now,
      updatedAt: now,
    };

    this.commands.set(commandId, command);

    // Send through transport
    this.transport.send({
      type: "command",
      commandId,
      deviceId,
      command: type,
    });

    return command;
  }

  async getCommand(commandId: string): Promise<Command | undefined> {
    return this.commands.get(commandId);
  }

  subscribeToDeviceState(
    _deviceId: string,
    callback: (state: DeviceState) => void,
  ): () => void {
    this.stateListeners.add(callback);
    // Emit current state immediately if available
    if (this.latestState) {
      callback(this.latestState);
    }
    return () => this.stateListeners.delete(callback);
  }

  // ── Connection awareness ──────────────────────────────────────────────

  getConnectionPhase(): ConnectionPhase {
    return this.status.phase;
  }

  getConnectionStatus(): HardwareConnectionStatus {
    return { ...this.status };
  }

  onConnectionChange(callback: ConnectionChangeHandler): () => void {
    this.connectionListeners.add(callback);
    return () => this.connectionListeners.delete(callback);
  }

  /** Access the underlying transport (for Connect Mode diagnostics). */
  getTransport(): DeviceTransport {
    return this.transport;
  }

  // ── Inbound message handling ──────────────────────────────────────────

  private handleInboundMessage(raw: HardwareInboundMessage): void {
    // Defensive validation — malformed messages must never crash the app
    if (!isValidInboundMessage(raw)) {
      console.warn("[HardwareProvider] Dropped malformed message:", raw);
      return;
    }

    this.lastMessageTime = Date.now();

    try {
      switch (raw.type) {
        case "telemetry":
          this.handleTelemetry(raw);
          break;
        case "device_status":
          this.handleDeviceStatus(raw);
          break;
        case "fault_update":
          this.handleFaultUpdate(raw);
          break;
        case "heartbeat":
          this.handleHeartbeat(raw);
          break;
        case "event":
          this.handleEvent(raw);
          break;
        case "command_result":
          this.handleCommandResult(raw);
          break;
      }
    } catch (error) {
      // Individual message processing errors must not crash the provider
      console.warn("[HardwareProvider] Error processing message:", error);
    }
  }

  private handleTelemetry(msg: HardwareInboundMessage & { type: "telemetry" }): void {
    this.latestState = msg.payload;
    this.status.telemetry.receiving = true;
    this.status.telemetry.lastReceived = msg.timestamp;
    this.status.telemetry.messageCount++;

    // If we were stale, we're back to connected
    if (this.status.phase === "STALE") {
      this.updatePhase("CONNECTED");
    }

    for (const listener of this.stateListeners) {
      try {
        listener(msg.payload);
      } catch {
        // Never let a listener error crash the provider
      }
    }
  }

  private handleDeviceStatus(msg: HardwareInboundMessage & { type: "device_status" }): void {
    this.status.esp32 = {
      connected: msg.esp32.connected,
      firmwareVersion: msg.esp32.firmwareVersion,
      lastSeen: msg.timestamp,
    };
    this.status.stm32 = {
      connected: msg.stm32.connected,
      lastComm: msg.stm32.lastComm,
    };
  }

  private handleFaultUpdate(msg: HardwareInboundMessage & { type: "fault_update" }): void {
    if (this.latestState && this.latestState.deviceId === msg.deviceId) {
      this.latestState = {
        ...this.latestState,
        fault: msg.fault,
        updatedAt: msg.timestamp,
      };
      for (const listener of this.stateListeners) {
        try {
          listener(this.latestState);
        } catch {
          // Ignore
        }
      }
    }
  }

  private handleHeartbeat(_msg?: HardwareInboundMessage & { type: "heartbeat" }): void {
    // Heartbeat is a keep-alive — the lastMessageTime update above is
    // all we need to prevent staleness detection.
  }

  private handleEvent(msg: HardwareInboundMessage & { type: "event" }): void {
    this.events.push(msg.payload);
    // Cap at 200 events
    if (this.events.length > 200) {
      this.events = this.events.slice(-200);
    }
  }

  private handleCommandResult(msg: HardwareInboundMessage & { type: "command_result" }): void {
    const existing = this.commands.get(msg.commandId);
    if (!existing) return;

    this.commands.set(msg.commandId, {
      ...existing,
      status: msg.status,
      reason: msg.reason ?? existing.reason,
      updatedAt: msg.timestamp,
    });
  }

  // ── Transport phase changes ───────────────────────────────────────────

  private handleTransportPhaseChange(phase: ConnectionPhase): void {
    this.updatePhase(phase);

    if (phase === "ERROR") {
      this.status.telemetry.receiving = false;
      this.attemptReconnect();
    }
  }

  // ── Staleness monitoring ──────────────────────────────────────────────

  private startStalenessMonitor(): void {
    if (this.stalenessTimer) {
      clearInterval(this.stalenessTimer);
    }

    this.lastMessageTime = Date.now();

    this.stalenessTimer = setInterval(() => {
      if (this.status.phase !== "CONNECTED" && this.status.phase !== "STALE") return;

      const age = Date.now() - this.lastMessageTime;

      if (age > this.config.errorTimeoutMs) {
        this.status.telemetry.receiving = false;
        this.updatePhase("ERROR");
        this.attemptReconnect();
      } else if (age > this.config.staleTimeoutMs && this.status.phase === "CONNECTED") {
        this.status.telemetry.receiving = false;
        this.updatePhase("STALE");
      }
    }, 5_000); // Check every 5s
  }

  // ── Reconnection ──────────────────────────────────────────────────────

  private attemptReconnect(): void {
    if (this.disposed) return;
    if (this.reconnectTimer) return; // Already scheduled

    if (
      this.config.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      this.status.error = `Max reconnect attempts (${this.config.maxReconnectAttempts}) reached`;
      this.updatePhase("ERROR");
      return;
    }

    this.updatePhase("RECONNECTING");
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.disposed || !this.deviceId) return;

      try {
        await this.transport.disconnect().catch(() => {});
        await this.transport.connect(this.deviceId);
        this.reconnectAttempts = 0;
        this.startStalenessMonitor();
      } catch {
        // Reconnect failed — will retry via next ERROR phase
        this.updatePhase("ERROR");
        this.attemptReconnect();
      }
    }, this.config.reconnectDelayMs);
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  private updatePhase(phase: ConnectionPhase): void {
    if (this.status.phase === phase) return;
    this.status.phase = phase;
    this.status.error = phase === "ERROR" ? (this.status.error ?? "Connection error") : undefined;

    for (const listener of this.connectionListeners) {
      try {
        listener(phase);
      } catch {
        // Never let a listener error crash the provider
      }
    }
  }
}
