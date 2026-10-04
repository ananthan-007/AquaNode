import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SimulatorProvider } from "@/lib/device/providers/simulator-provider";
import { HardwareProvider } from "@/lib/device/providers/hardware-provider";
import { MockHardwareTransport } from "@/lib/device/transports/mock-hardware-transport";

// ─── SimulatorProvider ───────────────────────────────────────────────────

describe("SimulatorProvider", () => {
  let provider: SimulatorProvider;

  beforeEach(() => {
    provider = new SimulatorProvider();
  });

  afterEach(() => {
    provider.dispose();
  });

  it("has source === 'simulator'", () => {
    expect(provider.source).toBe("simulator");
  });

  it("returns CONNECTED phase after initialization", async () => {
    await provider.initialize();
    expect(provider.getConnectionPhase()).toBe("CONNECTED");
  });

  it("returns a valid connection status", () => {
    const status = provider.getConnectionStatus();
    expect(status.dataSource).toBe("simulator");
    expect(status.phase).toBe("CONNECTED");
  });

  it("subscribeToDeviceState returns an unsubscribe function", async () => {
    await provider.initialize();
    const callback = vi.fn();
    const unsub = provider.subscribeToDeviceState("sim-device-1", callback);
    expect(typeof unsub).toBe("function");
    unsub();
  });
});

// ─── HardwareProvider + MockHardwareTransport ────────────────────────────

describe("HardwareProvider with MockHardwareTransport", () => {
  let transport: MockHardwareTransport;
  let provider: HardwareProvider;

  beforeEach(async () => {
    transport = new MockHardwareTransport({
      connectDelayMs: 50,
      telemetryIntervalMs: 100,
      commandAckDelayMs: 50,
      commandOutcome: "success",
      heartbeatIntervalMs: 0,
    });
    provider = new HardwareProvider(transport, {
      staleTimeoutMs: 5000,
      errorTimeoutMs: 15000,
      reconnectDelayMs: 500,
      maxReconnectAttempts: 3,
    });
    await provider.initialize();
  });

  afterEach(() => {
    provider.dispose();
  });

  it("has source === 'hardware'", () => {
    expect(provider.source).toBe("hardware");
  });

  it("starts in DISCONNECTED phase", () => {
    expect(provider.getConnectionPhase()).toBe("DISCONNECTED");
  });

  it("transitions to CONNECTED on successful connect", async () => {
    await provider.connect("test-device");
    expect(provider.getConnectionPhase()).toBe("CONNECTED");
  });

  it("receives telemetry after connecting", async () => {
    await provider.connect("test-device");

    // Wait for telemetry
    await delay(200);

    const state = await provider.getDeviceState("test-device");
    expect(state.deviceId).toBe("test-device");
    expect(typeof state.waterLevel).toBe("number");
  });

  it("notifies state subscribers when telemetry arrives", async () => {
    const callback = vi.fn();
    provider.subscribeToDeviceState("test-device", callback);

    await provider.connect("test-device");
    await delay(200);

    expect(callback).toHaveBeenCalled();
    const lastState = callback.mock.calls[callback.mock.calls.length - 1]![0];
    expect(lastState.deviceId).toBe("test-device");
  });

  it("creates commands in PENDING state", async () => {
    await provider.connect("test-device");

    const cmd = await provider.createCommand("test-device", "PUMP_ON");
    expect(cmd.status).toBe("PENDING");
    expect(cmd.type).toBe("PUMP_ON");
    expect(cmd.deviceId).toBe("test-device");
  });

  it("tracks command lifecycle through ack", async () => {
    await provider.connect("test-device");

    const cmd = await provider.createCommand("test-device", "PUMP_ON");

    // Wait for command processing
    await delay(200);

    const updated = await provider.getCommand(cmd.id);
    expect(updated).toBeDefined();
    expect(["RECEIVED", "EXECUTED"]).toContain(updated!.status);
  });

  it("throws when creating command while disconnected", async () => {
    await expect(
      provider.createCommand("test-device", "PUMP_ON"),
    ).rejects.toThrow(/DISCONNECTED/i);
  });

  it("transitions to DISCONNECTED on disconnect", async () => {
    await provider.connect("test-device");
    await provider.disconnect();
    expect(provider.getConnectionPhase()).toBe("DISCONNECTED");
  });

  it("can reconnect after disconnect", async () => {
    await provider.connect("test-device");
    await provider.disconnect();
    await provider.connect("test-device");
    expect(provider.getConnectionPhase()).toBe("CONNECTED");
  });

  it("notifies connection listeners on phase changes", async () => {
    const phases: string[] = [];
    provider.onConnectionChange((phase) => phases.push(phase));

    await provider.connect("test-device");
    await provider.disconnect();

    expect(phases).toContain("CONNECTING");
    expect(phases).toContain("CONNECTED");
    expect(phases).toContain("DISCONNECTED");
  });

  it("handles connection failure gracefully", async () => {
    transport.updateConfig({ connectShouldFail: true });

    // Need a new transport instance since the old one is already initialized
    const failTransport = new MockHardwareTransport({
      connectDelayMs: 50,
      connectShouldFail: true,
    });
    const failProvider = new HardwareProvider(failTransport, {
      maxReconnectAttempts: 0,
    });
    await failProvider.initialize();

    await expect(failProvider.connect("test-device")).rejects.toThrow();
    expect(failProvider.getConnectionPhase()).toBe("ERROR");

    failProvider.dispose();
  });

  it("cleans up all resources on dispose", async () => {
    await provider.connect("test-device");
    const callback = vi.fn();
    provider.subscribeToDeviceState("test-device", callback);

    provider.dispose();

    // After dispose, no more callbacks should fire
    await delay(200);
    const callCountAfterDispose = callback.mock.calls.length;
    await delay(200);
    expect(callback.mock.calls.length).toBe(callCountAfterDispose);
  });

  it("returns a complete connection status object", async () => {
    await provider.connect("test-device");
    await delay(150);

    const status = provider.getConnectionStatus();
    expect(status.phase).toBe("CONNECTED");
    expect(status.dataSource).toBe("hardware");
    expect(status.esp32.connected).toBe(true);
    expect(status.telemetry.receiving).toBe(true);
    expect(status.telemetry.messageCount).toBeGreaterThan(0);
  });
});

// ─── MockHardwareTransport scenarios ─────────────────────────────────────

describe("MockHardwareTransport", () => {
  it("rejects commands correctly", async () => {
    const transport = new MockHardwareTransport({
      connectDelayMs: 10,
      telemetryIntervalMs: 0,
      commandAckDelayMs: 30,
      commandOutcome: "reject",
      heartbeatIntervalMs: 0,
    });
    const provider = new HardwareProvider(transport);
    await provider.initialize();
    await provider.connect("test-device");

    // Need to wait for first telemetry for getDeviceState to work
    // Since telemetry is disabled, we test command flow directly
    const cmd = await provider.createCommand("test-device", "PUMP_ON");
    await delay(150);

    const updated = await provider.getCommand(cmd.id);
    expect(updated?.status).toBe("REJECTED");
    expect(updated?.reason).toContain("Safety check failed");

    provider.dispose();
  });

  it("fails commands correctly", async () => {
    const transport = new MockHardwareTransport({
      connectDelayMs: 10,
      telemetryIntervalMs: 0,
      commandAckDelayMs: 30,
      commandOutcome: "fail",
      heartbeatIntervalMs: 0,
    });
    const provider = new HardwareProvider(transport);
    await provider.initialize();
    await provider.connect("test-device");

    const cmd = await provider.createCommand("test-device", "PUMP_ON");
    await delay(150);

    const updated = await provider.getCommand(cmd.id);
    expect(updated?.status).toBe("FAILED");

    provider.dispose();
  });

  it("handles stale simulation", async () => {
    const transport = new MockHardwareTransport({
      connectDelayMs: 10,
      telemetryIntervalMs: 100,
      heartbeatIntervalMs: 0,
    });
    const provider = new HardwareProvider(transport, {
      staleTimeoutMs: 200,
      errorTimeoutMs: 5000,
    });
    await provider.initialize();
    await provider.connect("test-device");

    expect(provider.getConnectionPhase()).toBe("CONNECTED");

    // Simulate stale by stopping telemetry
    transport.simulateStale();

    // Wait a bit — the transport itself goes STALE
    await delay(100);
    expect(transport.connectionPhase).toBe("STALE");

    provider.dispose();
  });

  it("handles malformed messages without crashing", async () => {
    const transport = new MockHardwareTransport({
      connectDelayMs: 10,
      telemetryIntervalMs: 50,
      injectMalformed: true,
      heartbeatIntervalMs: 0,
    });
    const provider = new HardwareProvider(transport);
    await provider.initialize();
    await provider.connect("test-device");

    // Should not crash despite malformed messages every 5th tick
    await delay(500);

    expect(provider.getConnectionPhase()).toBe("CONNECTED");

    provider.dispose();
  });
});

// ─── Helper ──────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
