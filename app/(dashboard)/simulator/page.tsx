"use client";

import { useEffect, useState, useCallback } from "react";
import { simulator } from "@/lib/simulator/simulator";
import type { FaultInjection } from "@/lib/simulator/simulator";
import { SCENARIO_PRESETS } from "@/lib/simulator/scenarios";
import { isSimulatorMode } from "@/lib/device/service";

type Snapshot = ReturnType<typeof simulator.getSnapshot>;

export default function SimulatorPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  const refreshSnap = useCallback(() => {
    setSnap(simulator.getSnapshot());
  }, []);

  useEffect(() => {
    if (!isSimulatorMode()) return;
    if (!simulator.isRunning()) simulator.start();
    refreshSnap();
    const unsub = simulator.subscribe(() => refreshSnap());
    return unsub;
  }, [refreshSnap]);

  if (!isSimulatorMode()) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Simulator control panel is only available when <code>NEXT_PUBLIC_DEVICE_DATA_SOURCE=simulator</code>.
        </div>
      </main>
    );
  }

  if (!snap) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="text-sm text-slate-500">Loading simulator…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            ⚡ Simulator Control Panel
          </h1>
          <p className="text-sm text-slate-500">
            Development-only. Controls the virtual STM32 + ESP32 device.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/dashboard"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            ← Dashboard
          </a>
          <button
            type="button"
            onClick={() => { simulator.reset(); refreshSnap(); }}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            Reset All
          </button>
        </div>
      </div>

      {/* Simulation banner */}
      <div className="mb-4 rounded-xl border-2 border-dashed border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700">
        ⚡ SIMULATION MODE — All data below is simulated. Not connected to physical hardware.
      </div>

      {/* Scenario Presets */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Quick Presets</h2>
        <div className="flex flex-wrap gap-2">
          {SCENARIO_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => { preset.apply(); refreshSnap(); }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              title={preset.description}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Current State */}
        <Section title="Device State">
          <Row label="Water Level" value={`${snap.waterLevel}%`} />
          <Row label="Voltage" value={`${snap.voltage}V`} />
          <Row label="Voltage State" value={snap.voltageState} />
          <Row label="Pump" value={snap.pumpState} highlight={snap.pumpState === "ON" ? "green" : undefined} />
          <Row label="Mode" value={snap.mode} />
          <Row label="Dry Run" value={snap.dryRun ? "YES" : "No"} highlight={snap.dryRun ? "red" : undefined} />
          <Row label="Fault" value={snap.fault ?? "None"} highlight={snap.fault ? "red" : undefined} />
          <Row label="Sequence" value={`#${snap.sequence}`} />
          <Row label="Events" value={`${snap.eventCount}`} />
          <Row label="Commands" value={`${snap.commandCount}`} />
          <Row label="Engine" value={snap.running ? "RUNNING" : "STOPPED"} highlight={snap.running ? "green" : "red"} />
        </Section>

        {/* Direct Controls */}
        <Section title="Direct Controls">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Water Level</label>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={snap.waterLevel}
            onChange={(e) => { simulator.setWaterLevel(Number(e.target.value)); refreshSnap(); }}
            className="mb-3 w-full"
          />
          <div className="mb-3 text-xs text-slate-500">{snap.waterLevel}%</div>

          <label className="mb-1 block text-xs font-semibold text-slate-500">Voltage</label>
          <input
            type="range"
            min="100"
            max="300"
            step="1"
            value={snap.voltage}
            onChange={(e) => { simulator.setVoltage(Number(e.target.value)); refreshSnap(); }}
            className="mb-3 w-full"
          />
          <div className="mb-3 text-xs text-slate-500">{snap.voltage}V</div>

          <div className="flex gap-2">
            <CtrlButton
              label={snap.pumpState === "ON" ? "Pump: ON" : "Pump: OFF"}
              onClick={() => { simulator.setPumpState(snap.pumpState === "ON" ? "OFF" : "ON"); refreshSnap(); }}
              active={snap.pumpState === "ON"}
            />
            <CtrlButton
              label={snap.mode === "AUTO" ? "Mode: AUTO" : "Mode: MANUAL"}
              onClick={() => { simulator.setMode(snap.mode === "AUTO" ? "MANUAL" : "AUTO"); refreshSnap(); }}
              active={snap.mode === "AUTO"}
            />
          </div>
        </Section>

        {/* Fault Injection */}
        <Section title="Fault Injection">
          <p className="mb-3 text-xs text-slate-500">
            Toggle faults to simulate hardware failure conditions. The virtual STM32 will enforce safety responses.
          </p>
          {(Object.keys(snap.faults) as (keyof FaultInjection)[]).map((key) => (
            <FaultToggle
              key={key}
              label={faultLabel(key)}
              checked={snap.faults[key]}
              onChange={(v) => {
                simulator.setFaults({ [key]: v });
                refreshSnap();
              }}
            />
          ))}
        </Section>

        {/* Network Simulation */}
        <Section title="Network Simulation">
          <p className="mb-3 text-xs text-slate-500">
            Simulate Wi-Fi/internet connectivity issues. When disconnected, the dashboard should show STALE→OFFLINE.
          </p>
          <FaultToggle
            label="Network Connected"
            checked={snap.network.connected}
            onChange={(v) => {
              simulator.setNetwork({ connected: v });
              refreshSnap();
            }}
          />
          <label className="mt-3 mb-1 block text-xs font-semibold text-slate-500">Extra Latency (ms)</label>
          <input
            type="range"
            min="0"
            max="5000"
            step="100"
            value={snap.network.extraLatencyMs}
            onChange={(e) => {
              simulator.setNetwork({ extraLatencyMs: Number(e.target.value) });
              refreshSnap();
            }}
            className="w-full"
          />
          <div className="text-xs text-slate-500">{snap.network.extraLatencyMs}ms</div>
        </Section>
      </div>
    </main>
  );
}

// ─── UI Helpers ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: "green" | "red" }) {
  const color = highlight === "green" ? "text-emerald-600 font-semibold" : highlight === "red" ? "text-red-600 font-semibold" : "text-slate-800";
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-xs tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function CtrlButton({ label, onClick, active }: { label: string; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
        active
          ? "bg-emerald-500 text-white"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
}

function FaultToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50">
      <span className="text-xs text-slate-700">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 accent-violet-600"
      />
    </label>
  );
}

function faultLabel(key: keyof FaultInjection): string {
  const labels: Record<keyof FaultInjection, string> = {
    dryRun: "Dry Run",
    underVoltage: "Under Voltage",
    overVoltage: "Over Voltage",
    waterLevelSensorFault: "Water Level Sensor Fault",
    voltageSensorFault: "Voltage Sensor Fault",
    flowSensorFault: "Flow Sensor Fault",
    stm32CommFailure: "STM32 Communication Failure",
  };
  return labels[key];
}
