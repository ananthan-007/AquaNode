// Core data contract. Fields limited to the minimum set called out in the
// requirements — see docs/WEB_APP_SPEC.md Phase 2 note before adding fields.

export type VoltageState = "NORMAL" | "UNDER_VOLTAGE" | "OVER_VOLTAGE";
export type PumpState = "ON" | "OFF";
export type OperatingMode = "AUTO" | "MANUAL";
export type DeviceConnection = "ONLINE" | "OFFLINE";

export type Fault =
  | "DRY_RUN"
  | "UNDER_VOLTAGE"
  | "OVER_VOLTAGE"
  | "WATER_LEVEL_SENSOR_FAULT"
  | "VOLTAGE_SENSOR_FAULT"
  | "FLOW_SENSOR_FAULT"
  | "STM32_COMM_FAILURE"
  | "ESP32_CLOUD_FAILURE"
  | null;

export interface DeviceState {
  deviceId: string;
  waterLevel: number; // 0-100, single source of truth for numeric + visual
  voltage: number;
  voltageState: VoltageState;
  pumpState: PumpState;
  mode: OperatingMode;
  dryRun: boolean;
  fault: Fault;
  /** ONLINE/OFFLINE as last reported by the backend — distinct from the
   * derived stale/online status computed client-side from lastSeen. */
  deviceStatus: DeviceConnection;
  lastSeen: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  sequence: number;
  firmwareVersion?: string;
  stm32Connected?: boolean;
  lastTelemetryAt?: string;
}

export type CommandType =
  | "PUMP_ON"
  | "PUMP_OFF"
  | "SET_MODE_AUTO"
  | "SET_MODE_MANUAL"
  | "FAULT_RESET"
  | "REQUEST_LEVEL";

export type CommandStatus =
  | "PENDING"
  | "RECEIVED"
  | "EXECUTED"
  | "REJECTED"
  | "FAILED";

export interface Command {
  id: string;
  deviceId: string;
  type: CommandType;
  status: CommandStatus;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceEvent {
  id: string;
  deviceId: string;
  type:
    | "PUMP_STARTED"
    | "PUMP_STOPPED"
    | "TANK_FULL"
    | "LOW_WATER"
    | "VOLTAGE_WARNING"
    | "DRY_RUN"
    | "SENSOR_FAULT"
    | "DEVICE_OFFLINE";
  message: string;
  createdAt: string;
}
