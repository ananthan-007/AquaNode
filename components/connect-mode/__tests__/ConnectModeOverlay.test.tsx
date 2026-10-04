import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock device service
vi.mock("@/lib/device/service", () => ({
  getActiveProvider: vi.fn(() => ({
    getConnectionStatus: () => ({
      phase: "DISCONNECTED",
      dataSource: "simulator",
      esp32: { connected: false },
      stm32: { connected: false },
      telemetry: { receiving: false, messageCount: 0 },
    }),
    getConnectionPhase: () => "DISCONNECTED",
    onConnectionChange: vi.fn(() => () => {}),
    dispose: vi.fn(),
  })),
  getDataSource: vi.fn(() => "simulator"),
  setActiveProvider: vi.fn(),
}));

// Mock SimulatorProvider
vi.mock("@/lib/device/providers/simulator-provider", () => ({
  SimulatorProvider: vi.fn().mockImplementation(() => ({
    source: "simulator",
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    getConnectionPhase: () => "CONNECTED",
    getConnectionStatus: () => ({
      phase: "CONNECTED",
      dataSource: "simulator",
      esp32: { connected: true },
      stm32: { connected: true },
      telemetry: { receiving: true, messageCount: 0 },
    }),
    onConnectionChange: vi.fn(() => () => {}),
  })),
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
      // Immediately call with CONNECTED after connect
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
    vi.mocked(getDataSource).mockReturnValue("simulator");

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

  // ── Simulator view ────────────────────────────────────────────────────────

  it("shows simulator view by default when data source is simulator", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    expect(screen.getByText(/Virtual Simulator Active/i)).toBeDefined();
  });

  it("does NOT show a WebSocket URL input field", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    // The old design had a URL input — must not be present anymore
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

  it("shows 'Connect Real Hardware' button in simulator view", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    expect(screen.getByText(/Connect Real Hardware/i)).toBeDefined();
  });

  it("closes on Escape key", () => {
    render(<ConnectModeOverlay onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Discovery view ────────────────────────────────────────────────────────

  it("navigates to discovery view when 'Connect Real Hardware' is clicked", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    const btn = screen.getByText(/Connect Real Hardware/i);
    await act(async () => { fireEvent.click(btn); });

    // Should show discovery heading
    expect(screen.getByText(/Available AquaGuard Devices/i)).toBeDefined();
  });

  it("fetches devices from /api/device/devices on discovery view", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    const btn = screen.getByText(/Connect Real Hardware/i);
    await act(async () => { fireEvent.click(btn); });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/device/devices");
    });
  });

  it("shows discovered device in the list", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Connect Real Hardware/i));
    });

    await waitFor(() => {
      expect(screen.getByText(/AQ-ESP32-/i)).toBeDefined();
    });
  });

  it("shows ONLINE status badge for online device", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Connect Real Hardware/i));
    });

    await waitFor(() => {
      expect(screen.getByText(/ONLINE/i)).toBeDefined();
    });
  });

  it("shows STM32 Connected for device with stm32Connected=true", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Connect Real Hardware/i));
    });

    await waitFor(() => {
      // The device list shows STM32 status
      expect(document.body.textContent?.includes("Connected")).toBe(true);
    });
  });

  it("shows 'No devices registered' when backend returns empty list", async () => {
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ devices: [] }),
    } as unknown as Response);

    render(<ConnectModeOverlay onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Connect Real Hardware/i));
    });

    await waitFor(() => {
      expect(screen.getByText(/No devices registered/i)).toBeDefined();
    });
  });

  it("shows error message when device fetch fails", async () => {
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

    render(<ConnectModeOverlay onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Connect Real Hardware/i));
    });

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeDefined();
    });
  });

  // ── Hardware view ─────────────────────────────────────────────────────────

  it("shows hardware status cards after selecting a device", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Connect Real Hardware/i));
    });

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

    await act(async () => {
      fireEvent.click(screen.getByText(/Connect Real Hardware/i));
    });

    await waitFor(() => { screen.getByText(/AQ-ESP32-/i); });
    const deviceItem = screen.getByRole("option");
    await act(async () => { fireEvent.click(deviceItem); });

    expect(screen.getByRole("button", { name: /^Connect$/i })).toBeDefined();
  });

  it("instantiates CloudTransport (not WebSocketTransport) when connecting", async () => {
    // This test verifies that clicking Connect uses CloudTransport
    // (backend-powered cloud path), which is the Vercel-compatible transport.
    // WebSocketTransport (direct browser→ESP32) must never be used.
    const { CloudTransport } = await import("@/lib/device/transports/cloud-transport");

    render(<ConnectModeOverlay onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Connect Real Hardware/i));
    });

    await waitFor(() => { screen.getByText(/AQ-ESP32-/i); });
    const deviceItem = screen.getByRole("option");
    await act(async () => { fireEvent.click(deviceItem); });

    const connectBtn = screen.getByRole("button", { name: /^Connect$/i });
    await act(async () => { fireEvent.click(connectBtn); });

    await waitFor(() => {
      // CloudTransport (backend-powered, not direct WS) was instantiated
      expect(vi.mocked(CloudTransport)).toHaveBeenCalled();
    });
  });

  // ── Simulator preservation ────────────────────────────────────────────────

  it("can navigate back to devices list from hardware view", async () => {
    render(<ConnectModeOverlay onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Connect Real Hardware/i));
    });

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

    await act(async () => {
      fireEvent.click(screen.getByText(/Connect Real Hardware/i));
    });

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
