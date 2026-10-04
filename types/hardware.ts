/**
 * Hardware communication contract — typed message structures for
 * ESP32 ↔ Application communication.
 *
 * These types define the wire protocol that any hardware transport
 * (WebSocket, MQTT, REST, Supabase Realtime) must speak. They are
 * intentionally separate from the internal DeviceState/Command types
 * in types/device.ts — the provider layer translates between them.
 *
 * Architecture:
 *   ESP32  ─→  Transport  ─→  HardwareInboundMessage  ─→  Provider  ─→  DeviceState
 *   App    ─→  Provider   ─→  HardwareOutboundMessage  ─→  Transport ─→  ESP32
 */

import type { CommandStatus, CommandType, DeviceEvent, DeviceState, Fault } from "./device";

// ─── Connection Lifecycle ────────────────────────────────────────────────

/**
 * Connection lifecycle phases.  DISCONNECTED is the initial / terminal
 * state; the machine moves forward linearly and loops back via ERROR or
 * RECONNECTING.
 *
 *   DISCONNECTED → CONNECTING → CONNECTED → STALE → ERROR
 *                                  ↑                   ↓
 *                                  └── RECONNECTING ───┘
 */
export type ConnectionPhase =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "STALE"
  | "ERROR"
  | "RECONNECTING";

/** The provider type that is supplying device data. */
export type DataSource = "simulator" | "hardware" | "supabase";

// ─── ESP32 → Application (inbound) ──────────────────────────────────────

export interface TelemetryMessage {
  readonly type: "telemetry";
  readonly payload: DeviceState;
  readonly timestamp: string;
}

export interface DeviceStatusMessage {
  readonly type: "device_status";
  readonly deviceId: string;
  readonly esp32: { connected: boolean; firmwareVersion?: string };
  readonly stm32: { connected: boolean; lastComm?: string };
  readonly timestamp: string;
}

export interface FaultUpdateMessage {
  readonly type: "fault_update";
  readonly deviceId: string;
  readonly fault: Fault;
  readonly timestamp: string;
}

export interface HeartbeatMessage {
  readonly type: "heartbeat";
  readonly deviceId: string;
  readonly uptimeMs: number;
  readonly timestamp: string;
}

export interface EventMessage {
  readonly type: "event";
  readonly payload: Pick<DeviceEvent, "id" | "deviceId" | "type" | "message" | "createdAt">;
  readonly timestamp: string;
}

export interface CommandAckMessage {
  readonly type: "command_result";
  readonly commandId: string;
  readonly status: CommandStatus;
  readonly reason?: string;
  readonly timestamp: string;
}

/** Union of every message the hardware/backend can send to the app. */
export type HardwareInboundMessage =
  | TelemetryMessage
  | DeviceStatusMessage
  | FaultUpdateMessage
  | HeartbeatMessage
  | EventMessage
  | CommandAckMessage;

// ─── Application → ESP32/Backend (outbound) ──────────────────────────────

export interface CommandRequestMessage {
  readonly type: "command";
  readonly commandId: string;
  readonly deviceId: string;
  readonly command: CommandType;
}

export interface ConnectionHandshakeMessage {
  readonly type: "handshake";
  readonly deviceId: string;
  readonly clientVersion: string;
}

export type HardwareOutboundMessage =
  | CommandRequestMessage
  | ConnectionHandshakeMessage;

// ─── Hardware Connection Status (Connect Mode display) ───────────────────

/** Aggregate status shown in the hidden Connect Mode overlay. */
export interface HardwareConnectionStatus {
  phase: ConnectionPhase;
  dataSource: DataSource;
  esp32: {
    connected: boolean;
    firmwareVersion?: string;
    lastSeen?: string;
  };
  stm32: {
    connected: boolean;
    lastComm?: string;
  };
  telemetry: {
    receiving: boolean;
    lastReceived?: string;
    messageCount: number;
  };
  error?: string;
}

// ─── Hardware Auto-Discovery ─────────────────────────────────────────────

export interface DiscoveredDevice {
  deviceId: string;
  name?: string;
  status: "ONLINE" | "STALE" | "OFFLINE";
  lastSeen: string;
  firmwareVersion: string;
  stm32Connected: boolean;
  lastTelemetryAt: string | null;
}

export function defaultConnectionStatus(source: DataSource): HardwareConnectionStatus {
  return {
    phase: "DISCONNECTED",
    dataSource: source,
    esp32: { connected: false },
    stm32: { connected: false },
    telemetry: { receiving: false, messageCount: 0 },
  };
}

// ─── Defensive Message Validation ────────────────────────────────────────

const VALID_INBOUND_TYPES: ReadonlySet<string> = new Set([
  "telemetry",
  "device_status",
  "fault_update",
  "heartbeat",
  "event",
  "command_result",
]);

/**
 * Validates that an unknown value looks like a valid inbound hardware
 * message.  Does NOT deep-validate every field — that is the provider's
 * responsibility — but ensures the message has the right shape so that
 * a `switch (msg.type)` will not crash on garbage input.
 */
export function isValidInboundMessage(msg: unknown): msg is HardwareInboundMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (typeof m["type"] !== "string") return false;
  return VALID_INBOUND_TYPES.has(m["type"]);
}
