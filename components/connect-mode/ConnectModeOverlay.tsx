"use client";

/**
 * ConnectModeOverlay — hidden developer/hardware connection interface.
 *
 * NOT visible in normal UI, navigation, help, settings, or docs.
 * Activated only by pressing Space 5× in rapid succession.
 *
 * ARCHITECTURE:
 *   PWA → Backend/Cloud API → ESP32 → UART → STM32
 *
 * CRITICAL RULES:
 *   - No physical connection + no verified handshake = NEVER show Connected.
 *   - ESP32 is only "Connected" after the device sends a device_status
 *     message confirming it via a real backend handshake.
 *   - STM32 is only "Connected" when ESP32 explicitly reports stm32Connected=true.
 *   - Telemetry is only "Receiving" after real telemetry packets arrive.
 *   - No fake transports, no mock data, no simulated handshakes.
 *   - Never connect directly to 192.168.x.x or local ESP32 IP.
 *   - The backend URL is configured server-side, NOT entered by the user here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getActiveProvider,
  getDataSource,
  setActiveProvider,
  clearActiveProvider,
} from "@/lib/device/service";
import { HardwareProvider } from "@/lib/device/providers/hardware-provider";
import { CloudTransport } from "@/lib/device/transports/cloud-transport";
import type {
  ConnectionPhase,
  DiscoveredDevice,
  HardwareConnectionStatus,
} from "@/types/hardware";
import { defaultConnectionStatus } from "@/types/hardware";

// ─── Types ───────────────────────────────────────────────────────────────

interface ConnectModeOverlayProps {
  onClose: () => void;
}

/**
 * Internal view state — three phases:
 *   "simulator"  → simulator is active, show simulator info + "Switch to Hardware" button
 *   "discovery"  → fetching available ESP32 devices from backend
 *   "hardware"   → device selected, showing connection status + connect button
 */
type OverlayView = "discovery" | "hardware";

// ─── Component ───────────────────────────────────────────────────────────

export function ConnectModeOverlay({ onClose }: ConnectModeOverlayProps) {
  // Always start in discovery mode — no simulator
  const [view, setView] = useState<OverlayView>(() =>
    getDataSource() === "hardware" ? "hardware" : "discovery",
  );

  // Device discovery state
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Hardware connection state
  const [status, setStatus] = useState<HardwareConnectionStatus>(() =>
    getDataSource() === "hardware"
      ? (getActiveProvider()?.getConnectionStatus?.() ?? defaultConnectionStatus("hardware"))
      : defaultConnectionStatus("hardware"),
  );
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the hardware provider instance
  const hwProviderRef = useRef<HardwareProvider | null>(
    getDataSource() === "hardware" ? (getActiveProvider() as HardwareProvider) : null,
  );
  const connectionUnsubRef = useRef<(() => void) | null>(null);

  // Refresh hardware status periodically while overlay is open
  useEffect(() => {
    const interval = setInterval(() => {
      if (view === "hardware" && hwProviderRef.current) {
        const provider = hwProviderRef.current;
        if (typeof provider.getConnectionStatus === "function") {
          setStatus(provider.getConnectionStatus());
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [view]);

  // Auto-start discovery when overlay opens (no simulator view)
  useEffect(() => {
    if (view === "discovery") {
      void discoverDevices();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (connectionUnsubRef.current) {
        connectionUnsubRef.current();
        connectionUnsubRef.current = null;
      }
    };
  }, []);

  // ── Connection phase subscription ──────────────────────────────────

  const subscribeToPhase = useCallback((provider: HardwareProvider) => {
    if (connectionUnsubRef.current) {
      connectionUnsubRef.current();
    }
    connectionUnsubRef.current = provider.onConnectionChange(() => {
      setStatus(provider.getConnectionStatus());
    });
  }, []);

  // ── Device Discovery ───────────────────────────────────────────────

  const discoverDevices = useCallback(async () => {
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    try {
      const res = await fetch("/api/device/devices");
      if (!res.ok) {
        throw new Error(`Discovery failed: ${res.status}`);
      }
      const data: { devices: DiscoveredDevice[] } = await res.json();
      setDevices(data.devices ?? []);
    } catch (err) {
      setDiscoveryError(
        err instanceof Error ? err.message : "Failed to fetch devices",
      );
      setDevices([]);
    } finally {
      setDiscoveryLoading(false);
    }
  }, []);

  // ── Actions ────────────────────────────────────────────────────────

  /** Show device discovery screen */
  const showDiscovery = useCallback(() => {
    setView("discovery");
    setError(null);
    void discoverDevices();
  }, [discoverDevices]);

  /** Select a device and move to hardware connection view */
  const selectDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setView("hardware");
    setStatus(defaultConnectionStatus("hardware"));
    setError(null);
  }, []);

  /** Disconnect from hardware and clear the active provider */
  const disconnectAndClose = useCallback(() => {
    if (connectionUnsubRef.current) {
      connectionUnsubRef.current();
      connectionUnsubRef.current = null;
    }
    if (hwProviderRef.current) {
      hwProviderRef.current.dispose();
      hwProviderRef.current = null;
    }
    clearActiveProvider();
    setView("discovery");
    setSelectedDeviceId(null);
    setDevices([]);
    setStatus(defaultConnectionStatus("hardware"));
    setError(null);
  }, []);

  /**
   * Attempt a REAL backend-cloud connection to the selected ESP32.
   *
   * Flow: CloudTransport → POST /api/device/handshake → ESP32 → STM32
   * No direct browser-to-ESP32 connection. No 192.168.x.x. No WS URL.
   */
  const connectToHardware = useCallback(async () => {
    const deviceId = selectedDeviceId;
    if (!deviceId) {
      setError("No device selected");
      return;
    }

    setConnecting(true);
    setError(null);
    setStatus(defaultConnectionStatus("hardware"));

    try {
      // CloudTransport: Vercel-compatible REST + polling transport
      // No direct WS connection to ESP32 LAN address.
      const transport = new CloudTransport({ pollIntervalMs: 2000 });

      const hwProvider = new HardwareProvider(transport, {
        staleTimeoutMs: 30_000,
        errorTimeoutMs: 90_000,
        reconnectDelayMs: 5_000,
        maxReconnectAttempts: 10,
      });
      await hwProvider.initialize();

      hwProviderRef.current = hwProvider;
      subscribeToPhase(hwProvider);

      // Perform real end-to-end handshake:
      //   CloudTransport.connect() → POST /api/device/handshake
      //   → checks ESP32 heartbeat + STM32 UART + telemetry freshness
      await hwProvider.connect(deviceId);

      // Connection succeeded — swap the active provider
      setActiveProvider(hwProvider);
      setStatus(hwProvider.getConnectionStatus());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setError(message);
      setStatus(defaultConnectionStatus("hardware"));

      if (hwProviderRef.current) {
        hwProviderRef.current.dispose();
        hwProviderRef.current = null;
      }
    } finally {
      setConnecting(false);
    }
  }, [selectedDeviceId, subscribeToPhase]);

  /** Disconnect from hardware */
  const disconnectHardware = useCallback(async () => {
    if (hwProviderRef.current) {
      await hwProviderRef.current.disconnect();
      setStatus(hwProviderRef.current.getConnectionStatus());
    }
  }, []);

  /** Retry an existing connection */
  const retryConnection = useCallback(async () => {
    if (hwProviderRef.current && selectedDeviceId) {
      setConnecting(true);
      setError(null);
      try {
        await hwProviderRef.current.connect(selectedDeviceId);
        setActiveProvider(hwProviderRef.current);
        setStatus(hwProviderRef.current.getConnectionStatus());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Reconnect failed");
        setStatus(hwProviderRef.current.getConnectionStatus());
      } finally {
        setConnecting(false);
      }
    } else {
      await connectToHardware();
    }
  }, [connectToHardware, selectedDeviceId]);

  // ── Derived state ──────────────────────────────────────────────────

  const selectedDevice =
    devices.find((d) => d.deviceId === selectedDeviceId) ?? null;

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Hardware Connection Panel"
    >
      <div className="mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <div>
            <h2 className="text-sm font-bold tracking-wide text-slate-100">
              AquaGuard Hardware Connection
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {view === "hardware" && status.phase === "CONNECTED"
                ? "Connected to hardware"
                : view === "discovery"
                ? "Select a device to connect"
                : "Connecting…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close connection panel"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* No simulator view — panel goes straight to discovery */}
        {/* ── Discovery View ─────────────────────────────────────────── */}
        {view === "discovery" && (
          <>
            <div className="px-5 pt-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Available AquaGuard Devices
              </p>

              {discoveryLoading && (
                <div className="flex items-center gap-2 py-6 text-xs text-slate-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                  Fetching registered devices from backend…
                </div>
              )}

              {!discoveryLoading && discoveryError && (
                <div className="mb-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-400">
                  {discoveryError}
                </div>
              )}

              {!discoveryLoading && !discoveryError && devices.length === 0 && (
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-5 text-center">
                  <p className="text-xs font-semibold text-slate-300">No devices registered</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    No AquaGuard ESP32 devices have sent a heartbeat to this backend.
                    Ensure your ESP32 is powered and connected to Wi-Fi with the correct
                    backend URL configured in its firmware.
                  </p>
                </div>
              )}

              {!discoveryLoading && devices.length > 0 && (
                <ul className="space-y-2" role="listbox" aria-label="Available AquaGuard devices">
                  {devices.map((device) => (
                    <DeviceListItem
                      key={device.deviceId}
                      device={device}
                      selected={selectedDeviceId === device.deviceId}
                      onSelect={() => selectDevice(device.deviceId)}
                    />
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-2 border-t border-slate-700 px-5 py-4 mt-4">
              <button
                type="button"
                onClick={() => void discoverDevices()}
                disabled={discoveryLoading}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-800 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </>
        )}

        {/* ── Hardware View ─────────────────────────────────────────── */}
        {view === "hardware" && (
          <>
            {/* Selected device info */}
            {(selectedDevice ?? selectedDeviceId) && (
              <div className="border-b border-slate-700 px-5 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                  Selected Device
                </p>
                <div className="flex items-center gap-2">
                  <StatusDot connected={selectedDevice?.status === "ONLINE"} status={selectedDevice?.status} />
                  <span className="text-sm font-semibold text-slate-100">
                    {selectedDevice?.name ?? selectedDeviceId}
                  </span>
                  {selectedDevice && (
                    <span className="ml-auto text-[10px] text-slate-500">
                      FW {selectedDevice.firmwareVersion}
                    </span>
                  )}
                </div>
                {selectedDevice && (
                  <p className="mt-0.5 text-[10px] text-slate-600">
                    Last seen: {formatRelativeTime(selectedDevice.lastSeen)}
                    {" · "}STM32:{" "}
                    <span className={selectedDevice.stm32Connected ? "text-emerald-500" : "text-slate-500"}>
                      {selectedDevice.stm32Connected ? "Connected" : "Unknown"}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Hardware Status Grid */}
            <div className="grid grid-cols-2 gap-px bg-slate-700 p-px">
              <StatusCard
                label="ESP32"
                value={status.esp32.connected ? "Connected" : "Disconnected"}
                connected={status.esp32.connected}
                detail={
                  status.esp32.connected && status.esp32.firmwareVersion
                    ? `FW: ${status.esp32.firmwareVersion}`
                    : "Awaiting handshake"
                }
              />
              <StatusCard
                label="STM32"
                value={status.stm32.connected ? "Connected" : "Unavailable"}
                connected={status.stm32.connected}
                detail={
                  status.stm32.connected
                    ? "ESP32 confirmed UART link"
                    : "Requires ESP32 report"
                }
              />
              <StatusCard
                label="Telemetry"
                value={
                  status.telemetry.receiving
                    ? "Receiving"
                    : status.phase === "STALE"
                      ? "Stale"
                      : "Not Receiving"
                }
                connected={status.telemetry.receiving}
                detail={
                  status.telemetry.messageCount > 0
                    ? `${status.telemetry.messageCount} packets`
                    : "No packets yet"
                }
              />
              <StatusCard
                label="Connection"
                value={phaseLabel(status.phase)}
                connected={status.phase === "CONNECTED"}
                phase={status.phase}
              />
            </div>

            {/* Error Banner */}
            {error && (
              <div className="border-t border-red-900/50 bg-red-950/50 px-5 py-2.5 text-xs leading-relaxed text-red-400">
                {error}
              </div>
            )}

            {/* Connection Lifecycle Timeline */}
            {status.phase !== "DISCONNECTED" && (
              <div className="border-t border-slate-700 px-5 py-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Lifecycle
                </p>
                <div className="flex items-center gap-1 flex-wrap">
                  {(["DISCONNECTED", "CONNECTING", "CONNECTED", "STALE", "ERROR", "RECONNECTING"] as ConnectionPhase[]).map(
                    (phase) => (
                      <span
                        key={phase}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          status.phase === phase
                            ? phase === "CONNECTED"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : phase === "ERROR"
                                ? "bg-red-500/20 text-red-400"
                                : phase === "STALE"
                                  ? "bg-amber-500/20 text-amber-400"
                                  : "bg-sky-500/20 text-sky-400"
                            : "text-slate-600"
                        }`}
                      >
                        {phase}
                      </span>
                    ),
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 border-t border-slate-700 px-5 py-4">
              <button
                type="button"
                onClick={showDiscovery}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                ← Devices
              </button>

              <div className="ml-auto flex gap-2">
                {status.phase === "CONNECTED" && (
                  <button
                    type="button"
                    onClick={() => void disconnectHardware()}
                    className="rounded-lg bg-red-600/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                  >
                    Disconnect
                  </button>
                )}
                {(status.phase === "DISCONNECTED" || status.phase === "ERROR") && (
                  <button
                    type="button"
                    onClick={() => void (hwProviderRef.current ? retryConnection() : connectToHardware())}
                    disabled={connecting || !selectedDeviceId}
                    className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                  >
                    {connecting
                      ? "Connecting…"
                      : hwProviderRef.current
                        ? "Retry"
                        : "Connect"}
                  </button>
                )}
                {(status.phase === "CONNECTING" || status.phase === "RECONNECTING") && (
                  <span className="flex items-center gap-1.5 text-xs text-sky-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                    {status.phase === "CONNECTING" ? "Connecting…" : "Reconnecting…"}
                  </span>
                )}
              </div>
            </div>

            {/* Safety reminder */}
            <div className="border-t border-slate-700/50 px-5 py-2.5">
              <p className="text-[10px] leading-relaxed text-slate-600">
                SAFETY: Commands are requests only. The STM32 controller remains the final safety
                authority. No physical connection + no verified handshake = never display Connected.
                ESP32 is the network gateway — STM32 is never directly discovered.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function DeviceListItem({
  device,
  selected,
  onSelect,
}: {
  device: DiscoveredDevice;
  selected: boolean;
  onSelect: () => void;
}) {
  const isOnline = device.status === "ONLINE";
  const isStale = device.status === "STALE";

  return (
    <li
      role="option"
      aria-selected={selected}
      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
        selected
          ? "border-sky-500 bg-sky-500/10"
          : "border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-800"
      }`}
      onClick={onSelect}
    >
      <StatusDot connected={isOnline} status={device.status} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-100 truncate">
          {device.name ?? `AquaGuard ESP32 (${device.deviceId.slice(0, 8)})`}
        </p>
        <p className="text-[11px] text-slate-500">
          <span className={isOnline ? "text-emerald-400" : isStale ? "text-amber-400" : "text-slate-500"}>
            ● {device.status}
          </span>
          {" · "}Last seen: {formatRelativeTime(device.lastSeen)}
          {" · "}STM32:{" "}
          <span className={device.stm32Connected ? "text-emerald-400" : "text-slate-500"}>
            {device.stm32Connected ? "Connected" : "Unknown"}
          </span>
        </p>
        <p className="text-[10px] text-slate-600">
          FW {device.firmwareVersion}
          {device.lastTelemetryAt &&
            ` · Telemetry: ${formatRelativeTime(device.lastTelemetryAt)}`}
        </p>
      </div>
      {selected && (
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-sky-400" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
      )}
    </li>
  );
}

function StatusDot({
  connected,
  status,
}: {
  connected: boolean;
  status?: "ONLINE" | "STALE" | "OFFLINE" | string;
}) {
  const color = connected
    ? "bg-emerald-400"
    : status === "STALE"
      ? "bg-amber-400"
      : "bg-slate-600";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />;
}

function StatusCard({
  label,
  value,
  connected,
  detail,
  phase,
}: {
  label: string;
  value: string;
  connected: boolean;
  detail?: string;
  phase?: ConnectionPhase;
}) {
  const dotColor = connected
    ? "bg-emerald-400"
    : phase === "CONNECTING" || phase === "RECONNECTING"
      ? "bg-amber-400 animate-pulse"
      : phase === "ERROR"
        ? "bg-red-400"
        : phase === "STALE"
          ? "bg-amber-400"
          : "bg-slate-600";

  return (
    <div className="bg-slate-900 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="text-sm font-medium text-slate-200">{value}</span>
      </div>
      {detail && <p className="mt-0.5 text-[10px] text-slate-500">{detail}</p>}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function phaseLabel(phase: ConnectionPhase): string {
  switch (phase) {
    case "CONNECTED": return "Connected";
    case "CONNECTING": return "Connecting…";
    case "DISCONNECTED": return "Disconnected";
    case "STALE": return "Stale";
    case "ERROR": return "Error";
    case "RECONNECTING": return "Reconnecting…";
  }
}

function formatRelativeTime(iso: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "just now";
  if (diffMs < 5_000) return "just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
