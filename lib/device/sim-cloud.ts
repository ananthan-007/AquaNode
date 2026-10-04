/**
 * In-memory cloud store for simulator mode.
 *
 * Mirrors the Supabase layer (commands, device_state, events) that sits
 * between the PWA and the physical device in production:
 *
 *   User → PWA → service.ts → sim-cloud   (command request, read telemetry)
 *   Simulator (device agent) → sim-cloud  (pick up commands, publish telemetry)
 *
 * Real deployments replace sim-cloud with Supabase + an ingest endpoint
 * authenticated via per-device Bearer token — the PWA path stays the same.
 */

import { Command, CommandType, DeviceEvent, DeviceState } from "@/types/device";

type StateListener = (state: DeviceState) => void;

class SimCloud {
  private commands = new Map<string, Command>();
  private state: DeviceState | null = null;
  private events: DeviceEvent[] = [];
  private listeners = new Set<StateListener>();

  /** PWA path — insert a command request (always PENDING). */
  submitCommand(deviceId: string, type: CommandType): Command {
    const id = `sim-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const command: Command = {
      id,
      deviceId,
      type,
      status: "PENDING",
      reason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.commands.set(id, command);
    return command;
  }


  /** Device-agent path — advance command lifecycle. */
  updateCommand(id: string, patch: Partial<Pick<Command, "status" | "reason">>): void {
    const c = this.commands.get(id);
    if (!c) return;
    this.commands.set(id, { ...c, ...patch, updatedAt: new Date().toISOString() });
  }

  /** Device-agent path — publish telemetry snapshot. */
  publishDeviceState(state: DeviceState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  getDeviceState(deviceId: string): DeviceState {
    if (!this.state || this.state.deviceId !== deviceId) {
      throw new Error("No device state available");
    }
    return this.state;
  }

  /** Device-agent path — append an event. */
  addEvent(event: DeviceEvent): void {
    this.events.push(event);
    if (this.events.length > 200) {
      this.events = this.events.slice(-200);
    }
  }

  getEvents(deviceId: string): DeviceEvent[] {
    return this.events.filter((e) => e.deviceId === deviceId).reverse().slice(0, 50);
  }

  /** Device-agent path — poll for unprocessed command requests. */
  getPendingCommands(deviceId: string): Command[] {
    this.checkTimeouts();
    return Array.from(this.commands.values()).filter(
      (c) => c.deviceId === deviceId && c.status === "PENDING",
    );
  }

  /** Check for commands in flight (PENDING / RECEIVED) that have exceeded the 15s timeout. */
  checkTimeouts(timeoutMs = 15000): void {
    const now = Date.now();
    for (const [id, command] of this.commands.entries()) {
      if (command.status === "PENDING" || command.status === "RECEIVED") {
        const created = new Date(command.createdAt).getTime();
        if (now - created > timeoutMs) {
          this.commands.set(id, {
            ...command,
            status: "FAILED",
            reason: "COMMAND_TIMEOUT: Device did not respond within 15s",
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  getCommand(id: string): Command | undefined {
    this.checkTimeouts();
    return this.commands.get(id);
  }

  getCommandCount(): number {
    return this.commands.size;
  }

  subscribe(_deviceId: string, callback: StateListener): () => void {
    this.listeners.add(callback);
    if (this.state) callback(this.state);
    return () => {
      this.listeners.delete(callback);
    };
  }

  reset(): void {
    this.commands.clear();
    this.state = null;
    this.events = [];
  }
}

export const simCloud = new SimCloud();
