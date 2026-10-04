/**
 * Scenario presets for the simulator control panel.
 *
 * Each preset configures the simulator to a specific state for testing.
 * These are NOT the runtime data source — the simulator engine runs
 * continuously. Presets just set initial conditions.
 */

import { simulator } from "./simulator";

export interface ScenarioPreset {
  name: string;
  description: string;
  apply: () => void;
}

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    name: "Normal Operation",
    description: "Healthy system, AUTO mode, pump OFF, tank ~65%",
    apply: () => {
      simulator.reset();
      simulator.setWaterLevel(65);
      simulator.setFaults({
        dryRun: false,
        underVoltage: false,
        overVoltage: false,
        waterLevelSensorFault: false,
        voltageSensorFault: false,
        flowSensorFault: false,
        stm32CommFailure: false,
      });
      simulator.setNetwork({ connected: true, extraLatencyMs: 0 });
    },
  },
  {
    name: "Low Water",
    description: "Water at 12%, pump OFF, AUTO should trigger start",
    apply: () => {
      simulator.reset();
      simulator.setWaterLevel(12);
    },
  },
  {
    name: "Tank Full",
    description: "Water at 100%, pump ON, AUTO should trigger stop",
    apply: () => {
      simulator.reset();
      simulator.setWaterLevel(100);
      simulator.setPumpState("ON");
    },
  },
  {
    name: "Under Voltage",
    description: "Under-voltage fault — pump should stop and commands rejected",
    apply: () => {
      simulator.reset();
      simulator.setWaterLevel(50);
      simulator.setFaults({ underVoltage: true });
    },
  },
  {
    name: "Over Voltage",
    description: "Over-voltage fault — pump should stop and commands rejected",
    apply: () => {
      simulator.reset();
      simulator.setWaterLevel(50);
      simulator.setFaults({ overVoltage: true });
    },
  },
  {
    name: "Dry Run",
    description: "Dry run detection — pump stops, fault banner shown",
    apply: () => {
      simulator.reset();
      simulator.setWaterLevel(30);
      simulator.setPumpState("ON");
      simulator.setFaults({ dryRun: true });
    },
  },
  {
    name: "Sensor Fault",
    description: "Water level sensor fault — level frozen, fault shown",
    apply: () => {
      simulator.reset();
      simulator.setWaterLevel(42);
      simulator.setFaults({ waterLevelSensorFault: true });
    },
  },
  {
    name: "Device Offline",
    description: "Network disconnected — dashboard should show STALE then OFFLINE",
    apply: () => {
      simulator.reset();
      simulator.setWaterLevel(55);
      simulator.setNetwork({ connected: false });
    },
  },
  {
    name: "STM32 Comm Failure",
    description: "STM32 communication failure — commands will FAIL",
    apply: () => {
      simulator.reset();
      simulator.setWaterLevel(60);
      simulator.setFaults({ stm32CommFailure: true });
    },
  },
  {
    name: "Slow Network",
    description: "High latency network — commands take longer to process",
    apply: () => {
      simulator.reset();
      simulator.setWaterLevel(50);
      simulator.setNetwork({ connected: true, extraLatencyMs: 3000 });
    },
  },
];

export const SCENARIO_NAMES = SCENARIO_PRESETS.map((p) => p.name);
