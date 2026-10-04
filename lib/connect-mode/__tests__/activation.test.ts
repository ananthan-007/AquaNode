import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installConnectModeActivation } from "../activation";

// Helper to dispatch a keyboard event
function pressSpace(target?: EventTarget) {
  const event = new KeyboardEvent("keydown", {
    code: "Space",
    key: " ",
    bubbles: true,
    cancelable: true,
  });
  (target ?? document).dispatchEvent(event);
}

function pressKey(code: string, key: string) {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true }),
  );
}

describe("Connect Mode activation", () => {
  let activation: ReturnType<typeof installConnectModeActivation>;
  let callback: (() => void) & { mock: { calls: unknown[][] } };

  beforeEach(() => {
    callback = vi.fn() as unknown as typeof callback;
    activation = installConnectModeActivation(callback);
  });

  afterEach(() => {
    activation.destroy();
  });

  it("fires callback after 5 rapid Space presses", () => {
    for (let i = 0; i < 5; i++) {
      pressSpace();
    }
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire with fewer than 5 presses", () => {
    for (let i = 0; i < 4; i++) {
      pressSpace();
    }
    expect(callback).not.toHaveBeenCalled();
  });

  it("does NOT fire if non-Space keys are pressed", () => {
    for (let i = 0; i < 10; i++) {
      pressKey("KeyA", "a");
    }
    expect(callback).not.toHaveBeenCalled();
  });

  it("resets counter when timing window expires", () => {
    vi.useFakeTimers();

    // Press 4 times
    for (let i = 0; i < 4; i++) {
      pressSpace();
    }

    // Wait longer than the 2s window
    vi.advanceTimersByTime(2500);

    // Press 1 more (this should NOT trigger because the previous 4 expired)
    pressSpace();
    expect(callback).not.toHaveBeenCalled();

    // Now do 5 fresh presses
    for (let i = 0; i < 5; i++) {
      pressSpace();
    }
    expect(callback).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("fires again after reset", () => {
    // First activation
    for (let i = 0; i < 5; i++) pressSpace();
    expect(callback).toHaveBeenCalledTimes(1);

    // Second activation
    for (let i = 0; i < 5; i++) pressSpace();
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("does NOT fire when typing in an input field", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    for (let i = 0; i < 10; i++) {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          bubbles: true,
          cancelable: true,
        }),
      );
    }

    expect(callback).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("does NOT fire when typing in a textarea", () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    for (let i = 0; i < 10; i++) {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          bubbles: true,
          cancelable: true,
        }),
      );
    }

    expect(callback).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it("does NOT fire when typing in a contenteditable element", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    document.body.appendChild(div);
    div.focus();

    for (let i = 0; i < 10; i++) {
      // Dispatch on the div itself — bubbles:true carries it to document
      div.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          bubbles: true,
          cancelable: true,
        }),
      );
    }

    expect(callback).not.toHaveBeenCalled();
    document.body.removeChild(div);
  });

  it("cleans up listener on destroy()", () => {
    activation.destroy();

    for (let i = 0; i < 10; i++) {
      pressSpace();
    }
    expect(callback).not.toHaveBeenCalled();
  });
});
