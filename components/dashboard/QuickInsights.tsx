import { DeviceState } from "@/types/device";
import { DisplayConnection } from "@/lib/device/staleness";
import { FAULT_LABEL, VOLTAGE_LABEL } from "./presentation";

export function QuickInsights({
  state,
  connection,
}: {
  state: DeviceState;
  connection: DisplayConnection;
}) {
  const stale = connection !== "ONLINE";
  const offline = connection === "OFFLINE";
  const items: { ok: boolean; text: string }[] = [];

  if (offline) {
    items.push({ ok: false, text: "Live device telemetry unavailable" });
  } else if (stale) {
    items.push({ ok: false, text: "Displayed values may not be current" });
  }

  items.push({
    ok: state.fault !== "WATER_LEVEL_SENSOR_FAULT",
    text: `Water level is ${Math.max(0, Math.min(100, state.waterLevel))}% (reported)`,
  });

  items.push({
    ok: state.voltageState === "NORMAL",
    text: `Voltage is ${VOLTAGE_LABEL[state.voltageState]}`,
  });

  items.push({
    ok: true,
    text: `Pump is ${state.pumpState}`,
  });

  if (state.fault || state.dryRun) {
    items.push({
      ok: false,
      text: state.fault ? FAULT_LABEL[state.fault] : "Dry run / no water delivery detected",
    });
  } else if (!stale) {
    items.push({ ok: true, text: "No active faults" });
  }

  return (
    <section className="relative overflow-hidden rounded-3xl border border-sky-100 bg-white p-5 shadow-card">
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute -right-4 -bottom-4 h-28 w-28 text-sky-100"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12 3 5 6v6c0 5 3.5 7.5 7 9 3.5-1.5 7-4 7-9V6l-7-3z" />
      </svg>
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-600">Quick Insights</h2>
      <ul className="relative mt-4 space-y-2.5">
        {items.map((item) => (
          <li key={item.text} className="flex items-start gap-2.5 text-sm text-slate-700">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                item.ok ? "bg-emerald-500" : "bg-amber-500"
              }`}
              aria-hidden
            >
              {item.ok ? "✓" : "!"}
            </span>
            {item.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
