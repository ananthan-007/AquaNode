import { PumpState } from "@/types/device";

export function PumpStateCard({ pumpState, stale }: { pumpState: PumpState; stale: boolean }) {
  const isOn = pumpState === "ON";
  return (
    <article className="rounded-2xl border border-sky-100 bg-white p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
          <PumpIcon />
        </span>
        Pump Status
      </div>
      <p
        className={`text-2xl font-semibold ${
          stale ? "text-slate-400" : isOn ? "text-status-ok" : "text-slate-800"
        }`}
      >
        {pumpState}
      </p>
      <p
        className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          stale ? "bg-slate-100 text-slate-400" : isOn ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
        }`}
      >
        {isOn ? "Running" : "Idle"}
      </p>
      <p className="mt-2 text-[11px] leading-snug text-slate-400">
        Authoritative controller state — not the last START/STOP request.
      </p>
    </article>
  );
}

function PumpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M12 2.2C12 2.2 5 10.1 5 14.5a7 7 0 0 0 14 0C19 10.1 12 2.2 12 2.2z" />
    </svg>
  );
}
