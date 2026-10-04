/**
 * SimulatorProvider — wraps the existing simulator + sim-cloud into
 * the DeviceProvider interface.
 *
 * This provider delegates 100% to the battle-tested sim-cloud store
 * and simulator engine.  It does NOT go through the DeviceTransport
 * layer because the simulator's in-memory sim-cloud already IS the
 * transport — adding another abstraction would risk regressions for
 * zero benefit.
 *
 * The simulator engine (virtual STM32 + ESP32) continues to run in
 * the browser, publishing telemetry and processing commands through
 * sim-cloud exactly as it did before this refactor.
 */

import type { Command, CommandType, DeviceEvent, DeviceState } from "@/types/device";
import type { ConnectionPhase, HardwareConnectionStatus } from "@/types/hardware";
import type { DeviceProvider } from "@/lib/device/provider";
import { simulator } from "@/lib/simulator/simulator";
import { simCloud } from "@/lib/device/sim-cloud";

type ConnectionChangeHandler = (phase: ConnectionPhase) => void;

export class SimulatorProvider implements DeviceProvider {
  readonly source = "simulator" as const;

  private connectionListeners = new Set<ConnectionChangeHandler>();
  private started = false;

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (typeof window === "undefined") return; // SSR guard
    if (this.started) return;
    this.started = true;
    simulator.start();
  }

  dispose(): void {
    // Simulator is a shared singleton — don't stop it on dispose so
    // other subscribers (e.g. simulator control panel) keep working.
    this.connectionListeners.clear();
  }

  // ── Core data operations (delegate to existing sim-cloud) ─────────────

  async getDeviceState(deviceId: string): Promise<DeviceState> {
    return simCloud.getDeviceState(deviceId);
  }

  async getEvents(deviceId: string): Promise<DeviceEvent[]> {
    return simCloud.getEvents(deviceId);
  }

  createCommand(deviceId: string, type: CommandType): Promise<Command> {
    return Promise.resolve(simCloud.submitCommand(deviceId, type));
  }

  getCommand(commandId: string): Promise<Command | undefined> {
    return Promise.resolve(simCloud.getCommand(commandId));
  }

  subscribeToDeviceState(
    deviceId: string,
    callback: (state: DeviceState) => void,
  ): () => void {
    return simCloud.subscribe(deviceId, callback);
  }

  // ── Connection awareness ──────────────────────────────────────────────

  getConnectionPhase(): ConnectionPhase {
    // Simulator is always "connected" while running
    return simulator.isRunning() ? "CONNECTED" : "DISCONNECTED";
  }

  getConnectionStatus(): HardwareConnectionStatus {
    const running = simulator.isRunning();
    return {
      phase: running ? "CONNECTED" : "DISCONNECTED",
      dataSource: "simulator",
      esp32: { connected: running, firmwareVersion: "simulator" },
      stm32: { connected: running },
      telemetry: {
        receiving: running,
        lastReceived: running ? new Date().toISOString() : undefined,
        messageCount: 0, // Not tracked for simulator
      },
    };
  }

  onConnectionChange(callback: ConnectionChangeHandler): () => void {
    this.connectionListeners.add(callback);
    return () => this.connectionListeners.delete(callback);
  }
}
