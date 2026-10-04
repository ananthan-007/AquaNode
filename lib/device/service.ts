/**
 * Device service — the single boundary the PWA talks to.
 *
 * Hardware-only mode. No simulator. No fake data.
 * If hardware is not connected, callers receive a "not connected" error
 * and the dashboard shows a DeviceNotConnected state.
 *
 * The hidden Connect Mode (Space × 5) calls setActiveProvider() to
 * plug in a live HardwareProvider after a successful handshake.
 */

import type { Command, CommandType, DeviceEvent, DeviceState } from "@/types/device";
import type { DeviceProvider } from "@/lib/device/provider";

// ─── Provider management ─────────────────────────────────────────────────

/**
 * The active provider. Starts as null (not connected).
 * Set via setActiveProvider() when hardware connects through Connect Mode.
 */
let activeProvider: DeviceProvider | null = null;

function resolveProvider(): DeviceProvider | null {
  return activeProvider;
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function getDeviceState(deviceId: string): Promise<DeviceState> {
  const provider = resolveProvider();
  if (!provider) {
    throw new Error("Hardware not connected");
  }
  return provider.getDeviceState(deviceId);
}

export async function getEvents(deviceId: string): Promise<DeviceEvent[]> {
  const provider = resolveProvider();
  if (!provider) return [];
  return provider.getEvents(deviceId);
}

export async function createCommand(
  deviceId: string,
  type: CommandType,
): Promise<Command> {
  const provider = resolveProvider();
  if (!provider) {
    throw new Error("Hardware not connected — cannot send commands without a live connection.");
  }
  return provider.createCommand(deviceId, type);
}

export async function getCommand(
  commandId: string,
): Promise<Command | undefined> {
  const provider = resolveProvider();
  if (!provider) return undefined;
  return provider.getCommand(commandId);
}

export function subscribeToDeviceState(
  deviceId: string,
  callback: (state: DeviceState) => void,
): () => void {
  const provider = resolveProvider();
  if (!provider) return () => {};
  return provider.subscribeToDeviceState(deviceId, callback);
}

/** Always false — simulator has been removed. */
export function isSimulatorMode(): boolean {
  return false;
}

/** Whether any provider is currently active. */
export function isProviderActive(): boolean {
  return activeProvider !== null;
}

/** Whether the hardware provider is connected and receiving data. */
export function isHardwareConnected(): boolean {
  const provider = resolveProvider();
  if (!provider) return false;
  return provider.getConnectionPhase?.() === "CONNECTED";
}

// ─── Runtime provider management (for Connect Mode) ─────────────────────

const providerListeners = new Set<() => void>();

export function onProviderChange(listener: () => void): () => void {
  providerListeners.add(listener);
  return () => providerListeners.delete(listener);
}

/** Get the currently active provider instance (null if not connected). */
export function getActiveProvider(): DeviceProvider | null {
  return activeProvider;
}

/** Get the current data source identifier. */
export function getDataSource(): "hardware" | "none" {
  return activeProvider ? "hardware" : "none";
}

/**
 * Swap the active provider at runtime.
 * Used by the hidden Connect Mode after a successful ESP32 handshake.
 */
export function setActiveProvider(provider: DeviceProvider): void {
  if (activeProvider && activeProvider !== provider) {
    activeProvider.dispose?.();
  }
  activeProvider = provider;
  providerListeners.forEach((l) => l());
}

/**
 * Clear the active provider (disconnect all hardware).
 */
export function clearActiveProvider(): void {
  if (activeProvider) {
    activeProvider.dispose?.();
    activeProvider = null;
    providerListeners.forEach((l) => l());
  }
}
