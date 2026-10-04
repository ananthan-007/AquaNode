"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Command, CommandStatus, DeviceState } from "@/types/device";
import { getDeviceState, createCommand, getCommand, subscribeToDeviceState, isProviderActive } from "@/lib/device/service";
import { getDisplayConnection } from "@/lib/device/staleness";
import { TankLevel } from "./TankLevel";
import { FaultBanner } from "./FaultBanner";
import { ConnectionStatus } from "./ConnectionStatus";
import { CommandControls } from "./CommandControls";
import { CommandLifecycle } from "./CommandLifecycle";
import { ModeToggle } from "./ModeToggle";
import { QuickInsights } from "./QuickInsights";
import { MetricsStrip } from "./MetricsStrip";
import { DeviceNotConnected } from "@/components/device/DeviceNotConnected";

type LoadState = "loading" | "ready" | "error";

export function DashboardClient({ deviceId }: { deviceId: string }) {
  const [state, setState] = useState<DeviceState | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeCommand, setActiveCommand] = useState<Command | null>(null);
  const [observedStatuses, setObservedStatuses] = useState<CommandStatus[]>([]);
  const observedCommandId = useRef<string | null>(null);
  // Track whether any hardware provider is active (re-evaluated on every render).
  // This flips from false → true the moment Connect Mode sets the provider.
  const [providerActive, setProviderActive] = useState(isProviderActive);

  const refresh = useCallback(async () => {
    try {
      const s = await getDeviceState(deviceId);
      setState(s);
      setLoadState("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // "Hardware not connected" is not a crash — show not-connected UI
      if (msg.includes("not connected") || msg.includes("Waiting for")) {
        setLoadState("loading");
      } else {
        setErrorMsg(msg);
        setLoadState("error");
      }
    }
  }, [deviceId]);

  useEffect(() => {
    // Re-check provider status whenever the component mounts or deviceId changes.
    // This ensures navigating back to this page re-evaluates the connection.
    setProviderActive(isProviderActive());
    setLoadState("loading");
    setState(null);

    if (!isProviderActive()) return; // Nothing to subscribe to yet

    refresh();

    // Subscribe to real-time hardware state via Supabase Realtime WebSocket
    // + CloudTransport polling. Fires every time Postgres row changes.
    const unsubscribe = subscribeToDeviceState(deviceId, (newState) => {
      setState(newState);
      setProviderActive(true);
      setLoadState("ready");
    });

    return unsubscribe;
  }, [deviceId, refresh]);

  // Poll the active command until it reaches a terminal state — same logic
  // applies for both simulator and supabase paths so CommandControls never
  // needs to know which backend it's talking to.
  //
  // TIMEOUT: if the command remains non-terminal for 30s, mark it FAILED so
  // the UI doesn't poll forever (REL-1 fix).
  const COMMAND_TIMEOUT_MS = 30_000;
  useEffect(() => {
    if (!activeCommand) return;
    if (["EXECUTED", "REJECTED", "FAILED"].includes(activeCommand.status)) return;

    const startedAt = Date.now();
    const interval = setInterval(async () => {
      // Timeout check
      if (Date.now() - startedAt > COMMAND_TIMEOUT_MS) {
        clearInterval(interval);
        setActiveCommand((prev) =>
          prev ? { ...prev, status: "FAILED", reason: "Command timed out — no response from device", updatedAt: new Date().toISOString() } : prev
        );
        return;
      }
      try {
        const updated = await getCommand(activeCommand.id);
        if (updated) setActiveCommand(updated);
        if (updated && ["EXECUTED", "REJECTED", "FAILED"].includes(updated.status)) {
          refresh();
        }
      } catch {
        // Transient poll error — keep retrying until timeout
      }
    }, 500);

    return () => clearInterval(interval);
  }, [activeCommand, refresh]);

  useEffect(() => {
    if (!activeCommand) {
      observedCommandId.current = null;
      setObservedStatuses([]);
      return;
    }
    if (observedCommandId.current !== activeCommand.id) {
      observedCommandId.current = activeCommand.id;
      setObservedStatuses([activeCommand.status]);
      return;
    }
    setObservedStatuses((prev) =>
      prev.includes(activeCommand.status) ? prev : [...prev, activeCommand.status]
    );
  }, [activeCommand]);

  async function sendCommand(type: Parameters<typeof createCommand>[1]) {
    // CRITICAL PUMP-STATE RULE: sending a command only ever updates
    // activeCommand (PENDING→terminal). It NEVER touches `state.pumpState`
    // directly — pumpState is only ever read from getDeviceState() responses.
    try {
      const cmd = await createCommand(deviceId, type);
      setActiveCommand(cmd);
    } catch (e) {
      // Surface command-creation failures (network error, auth error, etc.)
      // as a synthetic FAILED command so the lifecycle panel shows the error.
      const syntheticFailed: Command = {
        id: `local-${Date.now()}`,
        deviceId,
        type,
        status: "FAILED",
        reason: e instanceof Error ? e.message : "Failed to send command",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setActiveCommand(syntheticFailed);
    }
  }

  // ── Render guards ──────────────────────────────────────────────────

  // No provider set yet — hardware not connected via Connect Mode
  if (!providerActive) {
    return <DeviceNotConnected />;
  }

  if (loadState === "loading") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Connecting to hardware…
      </div>
    );
  }

  if (loadState === "error" || !state) {
    return (
      <div className="rounded-xl border border-status-danger/30 bg-red-50 p-6 text-sm text-status-danger">
        Unable to load device status{errorMsg ? `: ${errorMsg}` : "."}
      </div>
    );
  }

  const connection = getDisplayConnection(state.lastSeen);
  const isStale = connection === "STALE" || connection === "OFFLINE";
  const isOffline = connection === "OFFLINE";

  return (
    <div className="space-y-4">
      <ConnectionStatus
        connection={connection}
        lastSeenIso={state.lastSeen}
        hasFault={Boolean(state.fault || state.dryRun)}
      />
      {isOffline && (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
          <span className="font-semibold">OFFLINE</span> — Device has not reported for an extended
          period. The values below are not current and should not be treated as live.
        </div>
      )}
      {!isOffline && isStale && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-slate-700">
          Device has not reported recently — the values below may be out of date and are not being
          treated as live.
        </div>
      )}
      <FaultBanner fault={state.fault} dryRun={state.dryRun} />

      <TankLevel
        waterLevel={state.waterLevel}
        stale={isStale}
        sensorFault={state.fault === "WATER_LEVEL_SENSOR_FAULT"}
        deviceId={state.deviceId}
        lastSeen={state.lastSeen}
        isSimulated={false}
      />

      <MetricsStrip state={state} connection={connection} stale={isStale} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ModeToggle
          mode={state.mode}
          stale={isStale}
          onChangeMode={(m) => sendCommand(m === "AUTO" ? "SET_MODE_AUTO" : "SET_MODE_MANUAL")}
        />
        <div className="lg:col-span-2">
          <CommandControls
            mode={state.mode}
            pumpState={state.pumpState}
            stale={isStale}
            activeCommand={activeCommand}
            onStart={() => sendCommand("PUMP_ON")}
            onStop={() => sendCommand("PUMP_OFF")}
            onRequestLevel={() => sendCommand("REQUEST_LEVEL")}
          />
        </div>
      </div>

      <CommandLifecycle command={activeCommand} observedStatuses={observedStatuses} />

      <QuickInsights state={state} connection={connection} />
    </div>
  );
}
