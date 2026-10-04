import { LevelTrend24h } from "./LevelTrend24h";

// CRITICAL WATER-LEVEL UI RULE: the visual fill height and the numeric label
// both derive from the same `waterLevel` prop. Never hard-code either.
export function TankLevel({
  waterLevel,
  stale,
  sensorFault,
  deviceId,
  lastSeen,
  isSimulated = false,
}: {
  waterLevel: number;
  stale: boolean;
  sensorFault: boolean;
  deviceId: string;
  lastSeen: string;
  isSimulated?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, waterLevel));
  const ticks = [100, 75, 50, 25, 0];

  let condition = "Reported";
  let conditionClass = "bg-slate-100 text-slate-700";
  if (stale) {
    condition = "Not current";
    conditionClass = "bg-amber-100 text-amber-800";
  } else if (sensorFault) {
    condition = "Sensor fault";
    conditionClass = "bg-red-100 text-red-800";
  }

  return (
    <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-card sm:p-6">
      <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[auto_1fr_minmax(13rem,18rem)]">
        <div className="flex items-stretch justify-center gap-3">
          <div className="flex w-10 flex-col justify-between py-3 text-right text-[11px] font-medium tabular-nums text-slate-400">
            {ticks.map((t) => (
              <span key={t}>{t}%</span>
            ))}
          </div>

          <div className="relative h-56 w-[7.75rem] sm:h-60 sm:w-32">
            <div className="absolute left-1/2 top-0 z-20 h-2.5 w-8 -translate-x-1/2 rounded-[2px] bg-slate-500" aria-hidden />
            <div
              className="absolute inset-x-0 bottom-3 top-2 overflow-hidden rounded-b-[2rem] border-[3px] border-slate-500 bg-[#eef3f7]"
              role="img"
              aria-label={`Water tank ${clamped} percent full${stale ? ", reading may not be current" : ""}`}
            >
              <div className="pointer-events-none absolute inset-y-1 left-0 flex flex-col justify-between">
                {ticks.map((t) => (
                  <span key={t} className="h-px w-2.5 bg-slate-300" />
                ))}
              </div>
              <div
                className={`absolute bottom-0 left-0 right-0 ${stale ? "" : "ag-water-live"} motion-safe:transition-[height] motion-safe:duration-700 motion-safe:ease-out`}
                style={{ height: `${clamped}%` }}
              >
                <div
                  className={`h-full w-full ${
                    stale ? "bg-slate-400" : "bg-gradient-to-b from-sky-400 to-sky-700"
                  }`}
                />
                {!stale && (
                  <div className="ag-water-surface absolute top-0 left-0 right-0 h-2 bg-sky-200/80" />
                )}
              </div>
              {stale && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/50 text-[11px] font-semibold text-slate-700">
                  Not live
                </div>
              )}
            </div>
            <div className="absolute bottom-0 left-[16%] h-3 w-3 rounded-[1px] bg-slate-500" aria-hidden />
            <div className="absolute bottom-0 right-[16%] h-3 w-3 rounded-[1px] bg-slate-500" aria-hidden />
          </div>
        </div>

        <div className="text-center lg:text-left">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Water Level</h2>
          <p className="mt-1 text-6xl font-semibold tabular-nums tracking-tight text-slate-900">
            {clamped}
            <span className="text-3xl font-medium text-slate-400">%</span>
          </p>
          <p className={`mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-semibold ${conditionClass}`}>
            {condition}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Percentage is the authoritative reported level. Capacity in litres is not in the device data.
          </p>
        </div>

        <LevelTrend24h
          deviceId={deviceId}
          waterLevel={waterLevel}
          lastSeen={lastSeen}
          stale={stale}
          isSimulated={isSimulated}
        />
      </div>
    </section>
  );
}
