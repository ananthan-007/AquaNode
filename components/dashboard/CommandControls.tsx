import { Command, OperatingMode, PumpState } from "@/types/device";
import { COMMAND_TYPE_LABEL } from "./presentation";

export function CommandControls({
  mode,
  pumpState,
  stale,
  activeCommand,
  onStart,
  onStop,
  onRequestLevel,
}: {
  mode: OperatingMode;
  pumpState: PumpState;
  stale: boolean;
  activeCommand: Command | null;
  onStart: () => void;
  onStop: () => void;
  onRequestLevel: () => void;
}) {
  const commandInFlight = !!activeCommand && ["PENDING", "RECEIVED"].includes(activeCommand.status);

  return (
    <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-card">
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-600">Manual Control</h2>
      <p className="mt-2 text-sm text-slate-600">
        Manual commands are requests and remain subject to controller safety checks.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        START does not mean the pump is ON. STOP does not mean the pump is OFF. Pump status above is
        the authoritative device/controller state.
      </p>

      {mode === "MANUAL" ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={stale || commandInFlight || pumpState === "ON"}
            onClick={onStart}
            aria-label="Request pump start"
            className="flex min-h-14 items-center gap-3 rounded-2xl bg-emerald-500 px-4 py-3 text-left text-white shadow-md shadow-emerald-300/40 disabled:opacity-40"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            <span>
              <span className="block text-sm font-semibold">START</span>
              <span className="block text-xs font-normal text-emerald-50">Request pump start</span>
            </span>
          </button>
          <button
            type="button"
            disabled={stale || commandInFlight || pumpState === "OFF"}
            onClick={onStop}
            aria-label="Request pump stop"
            className="flex min-h-14 items-center gap-3 rounded-2xl bg-rose-500 px-4 py-3 text-left text-white shadow-md shadow-rose-300/40 disabled:opacity-40"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </span>
            <span>
              <span className="block text-sm font-semibold">STOP</span>
              <span className="block text-xs font-normal text-rose-100">Request pump stop</span>
            </span>
          </button>
        </div>
      ) : (
        <p className="mt-4 rounded-2xl bg-sky-50 px-3 py-3 text-sm text-sky-800">
          Pump start/stop requests are only available in MANUAL mode. Switch mode to MANUAL to enable them.
        </p>
      )}

      <button
        type="button"
        disabled={stale || commandInFlight}
        onClick={onRequestLevel}
        aria-label="Request current water level"
        className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-left text-sm font-medium text-sky-900 disabled:opacity-40"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-200 text-sky-700" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3v4M12 17v4M5 12H3m18 0h-2M6.3 6.3 4.9 4.9m14.2 0-1.4 1.4M6.3 17.7l-1.4 1.4m14.2 0-1.4-1.4" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </span>
        <span>
          Request Current Level
          <span className="mt-0.5 block text-xs font-normal text-sky-700/70">Fetch/request latest level</span>
        </span>
      </button>

      {activeCommand && (
        <p className="mt-3 text-xs text-slate-500">
          Latest request: {COMMAND_TYPE_LABEL[activeCommand.type]}. Lifecycle is shown in Command
          status.
        </p>
      )}
    </section>
  );
}
