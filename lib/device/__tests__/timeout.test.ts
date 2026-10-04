import { describe, it, expect, beforeEach } from "vitest";
import { simCloud } from "../sim-cloud";

describe("Command Timeout Safety", () => {
  beforeEach(() => {
    simCloud.reset();
  });

  it("marks commands as FAILED with COMMAND_TIMEOUT after 15 seconds", () => {
    const cmd = simCloud.submitCommand("device-1", "PUMP_ON");
    expect(cmd.status).toBe("PENDING");

    // Override createdAt timestamp to 20 seconds in the past
    const pastTime = new Date(Date.now() - 20000).toISOString();
    (cmd as unknown as { createdAt: string }).createdAt = pastTime;

    const fetched = simCloud.getCommand(cmd.id);
    expect(fetched).toBeDefined();
    expect(fetched?.status).toBe("FAILED");
    expect(fetched?.reason).toContain("COMMAND_TIMEOUT");
  });

  it("does NOT mark commands as FAILED if within 15s window", () => {
    const cmd = simCloud.submitCommand("device-1", "PUMP_OFF");
    expect(cmd.status).toBe("PENDING");

    const fetched = simCloud.getCommand(cmd.id);
    expect(fetched?.status).toBe("PENDING");
  });
});
