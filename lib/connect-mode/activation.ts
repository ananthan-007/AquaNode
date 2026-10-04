/**
 * Connect Mode activation — detects 5× Space key presses within a
 * short timing window to reveal the hidden developer connection panel.
 *
 * RULES:
 *   - 5 Space presses required
 *   - All within a 2-second window
 *   - Counter resets if the window expires
 *   - MUST NOT trigger while typing in input/textarea/contenteditable
 *   - MUST NOT interfere with buttons or accessibility
 *   - Invisible to normal users
 */

/** The number of Space presses required to activate. */
const REQUIRED_PRESSES = 5;

/** Time window (ms) in which all presses must occur. */
const WINDOW_MS = 2000;

/** Elements that should NOT trigger activation when focused. */
const INPUT_SELECTORS = [
  "INPUT",
  "TEXTAREA",
  "SELECT",
] as const;

type ActivateCallback = () => void;

export interface ConnectModeActivation {
  /** Call to remove the keyboard listener. */
  destroy: () => void;
}

/**
 * Returns true if the active element is an input-like field where the
 * Space key should be left alone.
 */
function isTypingContext(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;

  // Standard form controls
  const tag = target.tagName;
  if (INPUT_SELECTORS.includes(tag as (typeof INPUT_SELECTORS)[number])) return true;

  // contenteditable regions
  if (target.isContentEditable) return true;
  if (target.getAttribute("contenteditable") === "true") return true;

  // Elements with an explicit role that implies text entry
  const role = target.getAttribute("role");
  if (role === "textbox" || role === "searchbox") return true;

  return false;
}

/**
 * Install a keydown listener that fires `onActivate` after the user
 * presses Space 5 times within `WINDOW_MS`.
 *
 * Returns a handle with a `destroy()` method for cleanup.
 */
export function installConnectModeActivation(
  onActivate: ActivateCallback,
): ConnectModeActivation {
  let pressTimestamps: number[] = [];

  function handleKeyDown(event: KeyboardEvent): void {
    // Only care about Space
    if (event.code !== "Space" && event.key !== " ") return;

    // Don't intercept when user is typing
    if (isTypingContext(event)) return;

    const now = Date.now();

    // Prune timestamps outside the window
    pressTimestamps = pressTimestamps.filter((t) => now - t < WINDOW_MS);

    pressTimestamps.push(now);

    if (pressTimestamps.length >= REQUIRED_PRESSES) {
      pressTimestamps = [];
      onActivate();
    }
  }

  // Use capture phase so we see the event before any stopPropagation
  // but we do NOT call preventDefault — Space must still work normally
  // for buttons and scrolling.
  document.addEventListener("keydown", handleKeyDown, { capture: false });

  return {
    destroy() {
      document.removeEventListener("keydown", handleKeyDown, { capture: false });
    },
  };
}
