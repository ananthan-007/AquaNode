import { VoltageState } from "@/types/device";
import { VOLTAGE_LABEL } from "./presentation";

export function VoltageCard({
  voltage,
  voltageState,
  stale,
}: {
  voltage: number;
  voltageState: VoltageState;
  stale: boolean;
}) {
  const ok = !stale && voltageState === "NORMAL";
  return (
    <article className="rounded-2xl border border-amber-100 bg-white p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
          <LightningIcon />
        </span>
        Supply Voltage
      </div>
      <p className={`text-2xl font-semibold tabular-nums ${stale ? "text-slate-400" : "text-slate-900"}`}>
        {voltage.toFixed(1)} V
      </p>
      <p
        className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          stale
            ? "bg-slate-100 text-slate-400"
            : ok
              ? "bg-emerald-100 text-emerald-700"
              : "bg-red-100 text-red-700"
        }`}
      >
        {VOLTAGE_LABEL[voltageState]}
      </p>
    </article>
  );
}

function LightningIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}
