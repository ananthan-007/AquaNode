import { CommandType, Fault, VoltageState } from "@/types/device";

export const FAULT_LABEL: Record<NonNullable<Fault>, string> = {
  DRY_RUN: "Dry run / no water delivery detected",
  UNDER_VOLTAGE: "Under-voltage — pump disabled",
  OVER_VOLTAGE: "Over-voltage — pump disabled",
  WATER_LEVEL_SENSOR_FAULT: "Water-level sensor fault",
  VOLTAGE_SENSOR_FAULT: "Voltage-sensor fault",
  FLOW_SENSOR_FAULT: "Flow/source-water sensor fault",
  STM32_COMM_FAILURE: "Controller communication failure",
  ESP32_CLOUD_FAILURE: "Gateway/cloud connection failure",
};

export const VOLTAGE_LABEL: Record<VoltageState, string> = {
  NORMAL: "Normal",
  UNDER_VOLTAGE: "Under-voltage",
  OVER_VOLTAGE: "Over-voltage",
};

export const COMMAND_TYPE_LABEL: Record<CommandType, string> = {
  PUMP_ON: "START request",
  PUMP_OFF: "STOP request",
  SET_MODE_AUTO: "AUTO mode request",
  SET_MODE_MANUAL: "MANUAL mode request",
  FAULT_RESET: "Fault reset request",
  REQUEST_LEVEL: "Current level request",
};

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
