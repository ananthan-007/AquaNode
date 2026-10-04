/**
 * DeviceProvider — the common interface that the dashboard / service
 * layer consumes.  Both the simulator and future hardware backends
 * implement this contract so they are interchangeable at runtime.
 *
 * Architecture:
 *
 *   Dashboard / UI
 *        ↓
 *   service.ts  (routes to active provider)
 *        ↓
 *   DeviceProvider  ← this interface
 *        ↓
 *   SimulatorProvider   OR   HardwareProvider
 *        ↓                        ↓
 *   sim-cloud (existing)     DeviceTransport
 *        ↓                        ↓
 *   Simulator engine        MockTransport / WebSocketTransport / …
 *                                 ↓
 *                           ESP32 (future)
 */

import type { Command, CommandType, DeviceEvent, DeviceState } from "@/types/device";
import type {
  ConnectionPhase,
  DataSource,
  HardwareConnectionStatus,
} from "@/types/hardware";

export interface DeviceProvider {
  // ── Identity ──────────────────────────────────────────────────────────

  /** Which data source this provider represents. */
  readonly source: DataSource;

  // ── Core data operations ──────────────────────────────────────────────

  /** Get the current device state snapshot. */
  getDeviceState(deviceId: string): Promise<DeviceState>;

  /** Get recent device events (newest first, capped). */
  getEvents(deviceId: string): Promise<DeviceEvent[]>;

  /**
   * Submit a command REQUEST.  Returns the command in PENDING state.
   *
   * SAFETY: This is a request, not an execution.  The hardware/STM32
   * remains the final safety authority.
   */
  createCommand(deviceId: string, type: CommandType): Promise<Command>;

  /** Poll for a command's current status. */
  getCommand(commandId: string): Promise<Command | undefined>;

  /**
   * Subscribe to live device state changes.
   * Returns an unsubscribe function.  Implementations must support
   * multiple concurrent subscribers.
   */
  subscribeToDeviceState(
    deviceId: string,
    callback: (state: DeviceState) => void,
  ): () => void;

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Initialise the provider (start simulator, open connection, etc.). */
  initialize?(): Promise<void>;

  /**
   * Release all resources (timers, connections, listeners).
   * Must be idempotent — calling dispose() twice must not throw.
   */
  dispose?(): void;

  // ── Connection awareness (primarily for HardwareProvider) ─────────────

  /** Current connection lifecycle phase. */
  getConnectionPhase(): ConnectionPhase;

  /** Detailed status for the hidden Connect Mode overlay. */
  getConnectionStatus(): HardwareConnectionStatus;

  /** Subscribe to connection phase transitions. Returns unsubscribe. */
  onConnectionChange(callback: (phase: ConnectionPhase) => void): () => void;
}
