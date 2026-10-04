/**
 * DeviceTransport — the communication channel abstraction.
 *
 * A transport handles the mechanics of moving messages between the
 * application and the device backend.  Providers use transports so
 * the same provider logic works over different physical channels.
 *
 * Architecture:
 *
 *   DeviceProvider
 *        ↓
 *   DeviceTransport  ← this interface
 *        ↓
 *   WebSocketTransport (production) / MockHardwareTransport (tests)
 *        ↓
 *   Backend / Cloud API → ESP32 → UART → STM32
 *
 * The simulator does NOT use DeviceTransport — it delegates to the
 * existing sim-cloud in-memory store which is already battle-tested.
 * This interface is designed specifically for the real hardware path.
 */

import type {
  ConnectionPhase,
  HardwareInboundMessage,
  HardwareOutboundMessage,
} from "@/types/hardware";

export interface DeviceTransport {
  /** Human-readable transport name (for logging / Connect Mode display). */
  readonly name: string;

  /** Current connection lifecycle phase. */
  readonly connectionPhase: ConnectionPhase;

  /**
   * Open a connection to the device backend.
   * Implementations should transition through CONNECTING → CONNECTED
   * (or → ERROR on failure) and emit connection change events.
   */
  connect(deviceId: string): Promise<void>;

  /**
   * Close the connection cleanly.
   * Must transition to DISCONNECTED and release all resources.
   * Idempotent — calling disconnect() when already disconnected is a no-op.
   */
  disconnect(): Promise<void>;

  /**
   * Send an outbound message to the backend / device.
   * Throws if the transport is not in CONNECTED phase.
   */
  send(message: HardwareOutboundMessage): void;

  /**
   * Register a handler for inbound messages from the backend / device.
   * Returns an unsubscribe function.
   */
  onMessage(handler: (msg: HardwareInboundMessage) => void): () => void;

  /**
   * Register a handler for connection phase transitions.
   * Returns an unsubscribe function.
   */
  onConnectionChange(handler: (phase: ConnectionPhase) => void): () => void;
}
