import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock device service
vi.mock("@/lib/device/service", () => ({
  getActiveProvider: vi.fn(() => ({
    getConnectionStatus: () => ({
      phase: "DISCONNECTED",
      dataSource: "hardware",
      esp32: { connected: false },
      stm32: { connected: false },
      telemetry: { receiving: false, messageCount: 0 },
    }),
    getConnectionPhase: () => "DISCONNECTED",
    onConnectionChange: vi.fn(() => () => {}),
    dispose: vi.fn(),
  })),
  getDataSource: vi.fn(() => "none"),
  setActiveProvider: vi.fn(),
  clearActiveProvider: vi.fn(),
}));

// Mock HardwareProvider
vi.mock("@/lib/device/providers/hardware-provider", () => ({
  HardwareProvider: vi.fn().mockImplementation(() => ({
    source: "hardware",
    initialize: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    getConnectionPhase: () => "CONNECTED",
    getConnectionStatus: () => ({
      phase: "CONNECTED",
      dataSource: "hardware",
      esp32: { connected: true, firmwareVersion: "1.0.0" },
      stm32: { connected: true },
      telemetry: { receiving: true, messageCount: 5 },
    }),
    onConnectionChange: vi.fn((_cb: (phase: string) => void) => {
      return () => {};
    }),
  })),
}));

// Mock CloudTransport
vi.mock("@/lib/device/transports/cloud-transport", () => ({
  CloudTransport: vi.fn().mockImplementation(() => ({
    name: "cloud",
    connectionPhase: "DISCONNECTED",
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    onConnectionChange: vi.fn(() => () => {}),
  })),
}));

import { ConnectModeOverlay } from "../ConnectModeOverlay";
import { getDataSource } from "@/lib/device/service";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ConnectModeOverlay", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDataSource).mockReturnValue("none");

    // Mock global fetch for device discovery
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          devices: [
            {
              deviceId: "AQ-ESP32-AABBCCDD",
              name: "AquaGuard ESP32 (AQ-ESP32-)",
              status: "ONLINE",
              lastSeen: new Date(Date.now() - 3_000).toISOString(),
              firmwareVersion: "1.2.3",
              stm32Connected: true,
              lastTelemetryAt: new Date(Date.now() - 5_000).toISOString(),
            },
          ],
        }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Discovery view ────────────────────────────────────────────────────────

  it("shows discovery view by default", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    expect(screen.getByText(/Available AquaGuard Devices/i)).toBeDefined();
  });

  it("does NOT show a WebSocket URL input field", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    const inputs = document.querySelectorAll("input[type='text']");
    expect(inputs.length).toBe(0);
  });

  it("does NOT show text about 'BACKEND WEBSOCKET URL'", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    expect(
      document.body.textContent?.toLowerCase().includes("backend websocket url"),
    ).toBe(false);
  });

  it("does NOT show ws:// or 192.168.x.x placeholder text", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    expect(document.body.textContent?.includes("192.168")).toBe(false);
    expect(document.body.textContent?.includes("ws://192.168")).toBe(false);
  });

  it("closes on Escape key", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fetches devices from /api/device/devices on mount", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/device/devices");
    });
  });

  it("shows discovered device in the list", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/AQ-ESP32-/i)).toBeDefined();
    });
  });

  it("shows ONLINE status badge for online device", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/ONLINE/i)).toBeDefined();
    });
  });

  it("shows STM32 Connected for device with stm32Connected=true", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    await waitFor(() => {
      expect(document.body.textContent?.includes("Connected")).toBe(true);
    });
  });

  it("shows empty state when backend returns empty list", async () => {
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ devices: [] }),
    } as unknown as Response);

    render(<ConnectModeOverlay onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/No AquaGuard ESP32 devices have sent a heartbeat/i)).toBeDefined();
    });
  });

  it("shows error message when device fetch fails", async () => {
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

    render(<ConnectModeOverlay onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeDefined();
    });
  });

  // ── Hardware view ─────────────────────────────────────────────────────────

  it("shows hardware status cards after selecting a device", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    // Wait for device list to load
    await waitFor(() => {
      expect(screen.getByText(/AQ-ESP32-/i)).toBeDefined();
    });

    // Click the device to select it
    const deviceItem = screen.getByRole("option");
    await act(async () => { fireEvent.click(deviceItem); });

    // Should now show hardware status cards
    expect(screen.getByText("ESP32")).toBeDefined();
    expect(screen.getByText("STM32")).toBeDefined();
    expect(screen.getByText("Telemetry")).toBeDefined();
    expect(screen.getByText("Connection")).toBeDefined();
  });

  it("shows Connect button when device is selected but not connected", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    await waitFor(() => { screen.getByText(/AQ-ESP32-/i); });
    const deviceItem = screen.getByRole("option");
    await act(async () => { fireEvent.click(deviceItem); });

    expect(screen.getByRole("button", { name: /^Connect$/i })).toBeDefined();
  });

  it("instantiates CloudTransport (not WebSocketTransport) when connecting", async () => {
    const { CloudTransport } = await import("@/lib/device/transports/cloud-transport");

    render(<ConnectModeOverlay onClose={onClose} />);

    await waitFor(() => { screen.getByText(/AQ-ESP32-/i); });
    const deviceItem = screen.getByRole("option");
    await act(async () => { fireEvent.click(deviceItem); });

    const connectBtn = screen.getByRole("button", { name: /^Connect$/i });
    await act(async () => { fireEvent.click(connectBtn); });

    await waitFor(() => {
      expect(vi.mocked(CloudTransport)).toHaveBeenCalled();
    });
  });

  it("can navigate back to devices list from hardware view", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    // Navigate to hardware view
    await waitFor(() => { screen.getByText(/AQ-ESP32-/i); });
    await act(async () => {
      fireEvent.click(screen.getByRole("option"));
    });

    // Should show hardware view with "← Devices" button
    const devicesBtn = screen.getByRole("button", { name: /← Devices/i });
    expect(devicesBtn).toBeDefined();

    // Click "← Devices" to go back to discovery
    await act(async () => { fireEvent.click(devicesBtn); });

    // Should show discovery view again
    expect(screen.getByText(/Available AquaGuard Devices/i)).toBeDefined();
  });

  it("shows safety reminder in hardware view", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    await waitFor(() => { screen.getByText(/AQ-ESP32-/i); });
    await act(async () => {
      fireEvent.click(screen.getByRole("option"));
    });

    expect(document.body.textContent?.toLowerCase().includes("safety")).toBe(true);
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  it("has role=dialog on the overlay", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    expect(document.querySelector('[role="dialog"]')).toBeDefined();
  });

  it("has aria-modal=true", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
  });

  it("has accessible close button", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    expect(
      screen.getByRole("button", { name: /Close connection panel/i }),
    ).toBeDefined();
  });
});
