import { OperatingMode } from "@/types/device";

export function ModeToggle({
  mode,
  stale,
  onChangeMode,
}: {
  mode: OperatingMode;
  stale: boolean;
  onChangeMode: (m: OperatingMode) => void;
}) {
  return (
    <article className="flex h-full flex-col justify-center rounded-3xl border border-orange-100 bg-white p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
          <GearIcon />
        </span>
        Mode
      </div>
      <div className="flex rounded-full border border-orange-100 bg-orange-50/60 p-1" role="group" aria-label="Operating mode">
        {(["AUTO", "MANUAL"] as const).map((m) => {
          const selected = mode === m;
          return (
            <button
              key={m}
              type="button"
              disabled={stale}
              aria-pressed={selected}
              onClick={() => onChangeMode(m)}
              className={`min-h-10 flex-1 rounded-full px-2 py-1.5 text-sm font-semibold disabled:opacity-40 ${
                selected
                  ? m === "MANUAL"
                    ? "bg-orange-500 text-white shadow-sm"
                    : "bg-sky-600 text-white shadow-sm"
                  : "text-slate-600"
              }`}
            >
              {m}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-400">
        Mode requests remain subject to controller safety checks.
      </p>
    </article>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </svg>
  );
}
