/**
 * AquaGuard Simulator Engine — Virtual Device
 *
 * Replaces the static-snapshot simulator with a continuous telemetry engine
 * that mimics real STM32+ESP32 behavior:
 *
 *   - Periodic telemetry updates (configurable interval)
 *   - Dynamic water level (fills when pump ON, drains when pump OFF)
 *   - Voltage fluctuation within configurable range
 *   - Virtual STM32 safety authority (rejects unsafe commands)
 *   - Fault injection (all fault types from requirements)
 *   - Network failure simulation (online/stale/offline)
 *   - Command lifecycle with configurable latency
 *   - Deterministic behavior for testing
 *
 * The simulator is the DEVICE AGENT (virtual ESP32 + STM32). It runs in the
 * browser and communicates with the PWA only through sim-cloud — the same
 * separation as a real ESP32 talking to Supabase via an ingest endpoint.
 *
 * Dev control panel (/simulator) talks directly to this agent for fault
 * injection and debugging, mirroring hardware-side diagnostics.
 */

import { Command, DeviceEvent, DeviceState, Fault, OperatingMode, PumpState, VoltageState } from "@/types/device";
import { simCloud } from "@/lib/device/sim-cloud";
import { SIM_DEVICE_ID } from "@/lib/device/identity";

// ─── Configuration ───────────────────────────────────────────────────────

export interface SimulatorConfig {
  /** Telemetry update interval in ms */
  telemetryIntervalMs: number;
  /** Water level change per second when pump is ON (increase) */
  fillRatePerSec: number;
  /** Water level change per second when pump is OFF (decrease / consumption) */
  drainRatePerSec: number;
  /** Base voltage */
  baseVoltage: number;
  /** Voltage fluctuation amplitude (+/-) */
  voltageFluctuation: number;
  /** Under-voltage threshold */
  underVoltageThreshold: number;
  /** Over-voltage threshold */
  overVoltageThreshold: number;
  /** Command processing latency (PENDING→RECEIVED) in ms */
  commandLatencyMs: number;
  /** Command execution latency (RECEIVED→EXECUTED/REJECTED) in ms */
  commandExecutionMs: number;
  /** Auto-start pump threshold (water level %) */
  autoStartThreshold: number;
  /** Auto-stop pump threshold (water level %) */
  autoStopThreshold: number;
}

const DEFAULT_CONFIG: SimulatorConfig = {
  telemetryIntervalMs: 2000,
  fillRatePerSec: 3.0,
  drainRatePerSec: 0.5,
  baseVoltage: 230,
  voltageFluctuation: 5,
  underVoltageThreshold: 200,
  overVoltageThreshold: 260,
  commandLatencyMs: 400,
  commandExecutionMs: 1000,
  autoStartThreshold: 20,
  autoStopThreshold: 95,
};

// ─── Fault Injection State ───────────────────────────────────────────────

export interface FaultInjection {
  dryRun: boolean;
  underVoltage: boolean;
  overVoltage: boolean;
  waterLevelSensorFault: boolean;
  voltageSensorFault: boolean;
  flowSensorFault: boolean;
  stm32CommFailure: boolean;
}

const DEFAULT_FAULTS: FaultInjection = {
  dryRun: false,
  underVoltage: false,
  overVoltage: false,
  waterLevelSensorFault: false,
  voltageSensorFault: false,
  flowSensorFault: false,
  stm32CommFailure: false,
};

// ─── Network Simulation State ────────────────────────────────────────────

export interface NetworkState {
  /** Simulates Wi-Fi / internet connectivity */
  connected: boolean;
  /** Additional latency added to command processing */
  extraLatencyMs: number;
}

const DEFAULT_NETWORK: NetworkState = {
  connected: true,
  extraLatencyMs: 0,
};

// ─── Listener type ───────────────────────────────────────────────────────

type StateListener = (state: DeviceState) => void;

// ─── Simulator Class ─────────────────────────────────────────────────────

class Simulator {
  // Physical state
  private waterLevel = 65;
  private voltage = 230;
  private pumpState: PumpState = "OFF";
  private mode: OperatingMode = "AUTO";
  private dryRun = false;
  private sequence = 0;
  private lastUpdateTime = Date.now();

  // Configuration
  private config: SimulatorConfig = { ...DEFAULT_CONFIG };
  private faults: FaultInjection = { ...DEFAULT_FAULTS };
  private network: NetworkState = { ...DEFAULT_NETWORK };

  // Event log (local copy for control-panel snapshot)
  private events: DeviceEvent[] = [];

  // Telemetry + command polling
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private commandPollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // Listeners for reactive updates
  private listeners: Set<StateListener> = new Set();

  // ─── Lifecycle ───────────────────────────────────────────────────────

  start() {
    if (this.running) return;
    this.running = true;
    this.lastUpdateTime = Date.now();
    this.telemetryTimer = setInterval(() => this.tick(), this.config.telemetryIntervalMs);
    this.commandPollTimer = setInterval(() => this.processPendingCommands(), 300);
    this.addEvent("PUMP_STOPPED", "Simulator started — device online");
    this.notifyListeners();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    if (this.commandPollTimer) {
      clearInterval(this.commandPollTimer);
      this.commandPollTimer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─── State Listeners ─────────────────────────────────────────────────

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    const state = this.getDeviceState();
    simCloud.publishDeviceState(state);
    this.listeners.forEach((fn) => fn(state));
  }

  // ─── Core Tick (telemetry cycle) ─────────────────────────────────────

  private tick() {
    const now = Date.now();
    const dtSec = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;
    this.sequence++;

    // Skip state updates if network is disconnected (simulates no telemetry)
    if (!this.network.connected) return;

    // Update physical simulation
    this.updateWaterLevel(dtSec);
    this.updateVoltage();
    this.evaluateFaults();
    this.evaluateAutoMode();

    this.notifyListeners();
  }

  // ─── Physical Simulation ─────────────────────────────────────────────

  private updateWaterLevel(dtSec: number) {
    if (this.faults.waterLevelSensorFault) return; // sensor broken, level frozen

    if (this.pumpState === "ON") {
      // Pump filling the tank
      this.waterLevel = Math.min(100, this.waterLevel + this.config.fillRatePerSec * dtSec);
    } else {
      // Natural consumption/drain
      this.waterLevel = Math.max(0, this.waterLevel - this.config.drainRatePerSec * dtSec);
    }
  }

  private updateVoltage() {
    if (this.faults.voltageSensorFault) return; // sensor broken, voltage frozen

    if (this.faults.underVoltage) {
      // Simulate under-voltage condition
      this.voltage = this.config.underVoltageThreshold - 15 + Math.random() * 5;
    } else if (this.faults.overVoltage) {
      // Simulate over-voltage condition
      this.voltage = this.config.overVoltageThreshold + 10 + Math.random() * 5;
    } else {
      // Normal fluctuation
      this.voltage = this.config.baseVoltage + (Math.random() - 0.5) * 2 * this.config.voltageFluctuation;
    }
  }

  private evaluateFaults() {
    // Dry run: pump is ON but water level isn't rising (simulated)
    if (this.faults.dryRun && this.pumpState === "ON") {
      this.dryRun = true;
      // STM32 safety: stop pump on dry run
      this.pumpState = "OFF";
      this.addEvent("DRY_RUN", "Dry run detected — pump stopped by controller");
    } else if (!this.faults.dryRun) {
      this.dryRun = false;
    }
  }

  private evaluateAutoMode() {
    if (this.mode !== "AUTO") return;
    if (this.getActiveFault()) return; // Don't auto-control when faulted

    if (this.pumpState === "OFF" && this.waterLevel <= this.config.autoStartThreshold) {
      this.pumpState = "ON";
      this.addEvent("PUMP_STARTED", `Auto-start: water level at ${Math.round(this.waterLevel)}%`);
    } else if (this.pumpState === "ON" && this.waterLevel >= this.config.autoStopThreshold) {
      this.pumpState = "OFF";
      this.addEvent("PUMP_STOPPED", `Auto-stop: tank full at ${Math.round(this.waterLevel)}%`);
      this.addEvent("TANK_FULL", "Tank full");
    }
  }

  // ─── Fault Resolution ────────────────────────────────────────────────

  private getActiveFault(): Fault {
    if (this.faults.stm32CommFailure) return "STM32_COMM_FAILURE";
    if (this.faults.dryRun) return "DRY_RUN";
    if (this.faults.underVoltage || this.getVoltageState() === "UNDER_VOLTAGE") return "UNDER_VOLTAGE";
    if (this.faults.overVoltage || this.getVoltageState() === "OVER_VOLTAGE") return "OVER_VOLTAGE";
    if (this.faults.waterLevelSensorFault) return "WATER_LEVEL_SENSOR_FAULT";
    if (this.faults.voltageSensorFault) return "VOLTAGE_SENSOR_FAULT";
    if (this.faults.flowSensorFault) return "FLOW_SENSOR_FAULT";
    return null;
  }

  private getVoltageState(): VoltageState {
    if (this.voltage < this.config.underVoltageThreshold) return "UNDER_VOLTAGE";
    if (this.voltage > this.config.overVoltageThreshold) return "OVER_VOLTAGE";
    return "NORMAL";
  }

  // ─── Public State Access ─────────────────────────────────────────────

  getDeviceState(): DeviceState {
    const now = new Date().toISOString();
    const isConnected = this.network.connected;

    return {
      deviceId: SIM_DEVICE_ID,
      waterLevel: Math.round(this.waterLevel * 10) / 10,
      voltage: Math.round(this.voltage * 10) / 10,
      voltageState: this.getVoltageState(),
      pumpState: this.pumpState,
      mode: this.mode,
      dryRun: this.dryRun,
      fault: this.getActiveFault(),
      deviceStatus: isConnected ? "ONLINE" : "OFFLINE",
      lastSeen: isConnected ? now : new Date(Date.now() - 120_000).toISOString(),
      updatedAt: now,
      sequence: this.sequence,
    };
  }

  getEvents(): DeviceEvent[] {
    return simCloud.getEvents(SIM_DEVICE_ID);
  }

  // ─── Command Processing (Virtual STM32 Safety Authority) ─────────────
  // Commands arrive from sim-cloud (mirrors ESP32 polling Supabase).

  private processPendingCommands() {
    if (!this.network.connected) return;

    for (const command of simCloud.getPendingCommands(SIM_DEVICE_ID)) {
      this.acceptCommand(command);
    }
  }

  private acceptCommand(command: Command) {
    const id = command.id;
    const totalLatency = this.config.commandLatencyMs + this.network.extraLatencyMs;
    const executionLatency = this.config.commandExecutionMs + this.network.extraLatencyMs;

    if (this.faults.stm32CommFailure) {
      setTimeout(() => simCloud.updateCommand(id, { status: "RECEIVED" }), totalLatency);
      setTimeout(() => {
        simCloud.updateCommand(id, { status: "FAILED", reason: "STM32 communication failure" });
      }, totalLatency + executionLatency);
      return;
    }

    setTimeout(() => simCloud.updateCommand(id, { status: "RECEIVED" }), totalLatency);
    setTimeout(() => this.resolveCommand(id), totalLatency + executionLatency);
  }

  private setCommandResult(id: string, status: "EXECUTED" | "REJECTED" | "FAILED", reason: string | null = null) {
    simCloud.updateCommand(id, { status, reason });
  }

  /**
   * Virtual STM32 safety authority — evaluates whether a command should be
   * executed or rejected based on current conditions.
   */
  private resolveCommand(id: string) {
    const c = simCloud.getCommand(id);
    if (!c) return;

    // SAFETY CHECKS — STM32 is the final authority
    const fault = this.getActiveFault();
    const voltageState = this.getVoltageState();

    switch (c.type) {
      case "PUMP_ON": {
        // Reject if any safety fault is active
        if (fault) {
          this.setCommandResult(id, "REJECTED", fault);
          return;
        }
        if (voltageState !== "NORMAL") {
          this.setCommandResult(id, "REJECTED", voltageState);
          return;
        }
        if (this.waterLevel >= 100) {
          this.setCommandResult(id, "REJECTED", "Tank is full");
          return;
        }
        // Safe to execute
        this.pumpState = "ON";
        this.setCommandResult(id, "EXECUTED");
        this.addEvent("PUMP_STARTED", "Pump started (manual command)");
        break;
      }

      case "PUMP_OFF": {
        this.pumpState = "OFF";
        this.setCommandResult(id, "EXECUTED");
        this.addEvent("PUMP_STOPPED", "Pump stopped (manual command)");
        break;
      }

      case "SET_MODE_AUTO": {
        this.mode = "AUTO";
        this.setCommandResult(id, "EXECUTED");
        break;
      }

      case "SET_MODE_MANUAL": {
        this.mode = "MANUAL";
        this.setCommandResult(id, "EXECUTED");
        break;
      }

      case "FAULT_RESET": {
        // Only reset if the underlying cause has been removed
        if (fault && !this.hasInjectedFault()) {
          this.dryRun = false;
          this.setCommandResult(id, "EXECUTED");
        } else if (fault) {
          this.setCommandResult(id, "REJECTED", `Cannot reset: ${fault} still active`);
        } else {
          this.setCommandResult(id, "EXECUTED"); // No fault to reset
        }
        break;
      }

      case "REQUEST_LEVEL": {
        this.setCommandResult(id, "EXECUTED");
        break;
      }

      default:
        this.setCommandResult(id, "FAILED", `Unknown command type`);
    }

    this.notifyListeners();
  }

  private hasInjectedFault(): boolean {
    return Object.values(this.faults).some(Boolean);
  }

  // ─── Event Management ────────────────────────────────────────────────

  private addEvent(type: DeviceEvent["type"], message: string) {
    const event: DeviceEvent = {
      id: `sim-evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      deviceId: SIM_DEVICE_ID,
      type,
      message,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    simCloud.addEvent(event);
    // Keep only last 200 events
    if (this.events.length > 200) {
      this.events = this.events.slice(-200);
    }
  }

  // ─── Control Panel API ───────────────────────────────────────────────

  getConfig(): SimulatorConfig {
    return { ...this.config };
  }

  setConfig(partial: Partial<SimulatorConfig>) {
    this.config = { ...this.config, ...partial };
    // Restart telemetry timer if interval changed
    if (partial.telemetryIntervalMs && this.running) {
      this.stop();
      this.start();
    }
  }

  getFaults(): FaultInjection {
    return { ...this.faults };
  }

  setFaults(partial: Partial<FaultInjection>) {
    const prev = { ...this.faults };
    this.faults = { ...this.faults, ...partial };

    // Generate events for newly injected faults
    if (!prev.dryRun && this.faults.dryRun) this.addEvent("DRY_RUN", "Dry run condition injected");
    if (!prev.underVoltage && this.faults.underVoltage) this.addEvent("VOLTAGE_WARNING", "Under-voltage condition injected");
    if (!prev.overVoltage && this.faults.overVoltage) this.addEvent("VOLTAGE_WARNING", "Over-voltage condition injected");
    if (!prev.waterLevelSensorFault && this.faults.waterLevelSensorFault) this.addEvent("SENSOR_FAULT", "Water level sensor fault injected");
    if (!prev.voltageSensorFault && this.faults.voltageSensorFault) this.addEvent("SENSOR_FAULT", "Voltage sensor fault injected");
    if (!prev.flowSensorFault && this.faults.flowSensorFault) this.addEvent("SENSOR_FAULT", "Flow sensor fault injected");
    if (!prev.stm32CommFailure && this.faults.stm32CommFailure) this.addEvent("DEVICE_OFFLINE", "STM32 communication failure injected");

    // Safety: stop pump if voltage fault injected
    if ((this.faults.underVoltage || this.faults.overVoltage) && this.pumpState === "ON") {
      this.pumpState = "OFF";
      this.addEvent("PUMP_STOPPED", "Pump stopped — voltage fault safety shutdown");
    }

    this.notifyListeners();
  }

  getNetwork(): NetworkState {
    return { ...this.network };
  }

  setNetwork(partial: Partial<NetworkState>) {
    const wasConnected = this.network.connected;
    this.network = { ...this.network, ...partial };
    if (wasConnected && !this.network.connected) {
      this.addEvent("DEVICE_OFFLINE", "Network disconnected (simulated)");
    }
    this.notifyListeners();
  }

  setWaterLevel(level: number) {
    this.waterLevel = Math.max(0, Math.min(100, level));
    this.notifyListeners();
  }

  setVoltage(v: number) {
    this.voltage = Math.max(0, v);
    this.notifyListeners();
  }

  setPumpState(state: PumpState) {
    this.pumpState = state;
    this.notifyListeners();
  }

  setMode(mode: OperatingMode) {
    this.mode = mode;
    this.notifyListeners();
  }

  /** Reset simulator to default state */
  reset() {
    this.stop();
    this.waterLevel = 65;
    this.voltage = this.config.baseVoltage;
    this.pumpState = "OFF";
    this.mode = "AUTO";
    this.dryRun = false;
    this.sequence = 0;
    this.events = [];
    simCloud.reset();
    this.faults = { ...DEFAULT_FAULTS };
    this.network = { ...DEFAULT_NETWORK };
    this.lastUpdateTime = Date.now();
    this.notifyListeners();
    this.start();
  }

  // ─── Snapshot State (for control panel display) ──────────────────────

  getSnapshot() {
    return {
      waterLevel: Math.round(this.waterLevel * 10) / 10,
      voltage: Math.round(this.voltage * 10) / 10,
      pumpState: this.pumpState,
      mode: this.mode,
      dryRun: this.dryRun,
      fault: this.getActiveFault(),
      voltageState: this.getVoltageState(),
      sequence: this.sequence,
      running: this.running,
      config: this.getConfig(),
      faults: this.getFaults(),
      network: this.getNetwork(),
      eventCount: this.events.length,
      commandCount: simCloud.getCommandCount(),
    };
  }
}

export const simulator = new Simulator();
