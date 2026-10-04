import Link from "next/link";
import { DeviceEvent } from "@/types/device";
import { formatClock } from "./presentation";

const BADGE: Record<DeviceEvent["type"], string> = {
  PUMP_STARTED: "bg-emerald-100 text-emerald-700",
  PUMP_STOPPED: "bg-slate-100 text-slate-600",
  TANK_FULL: "bg-sky-100 text-sky-700",
  LOW_WATER: "bg-amber-100 text-amber-800",
  VOLTAGE_WARNING: "bg-rose-100 text-rose-700",
  DRY_RUN: "bg-rose-100 text-rose-700",
  SENSOR_FAULT: "bg-rose-100 text-rose-700",
  DEVICE_OFFLINE: "bg-slate-200 text-slate-600",
};

const DOT: Record<DeviceEvent["type"], string> = {
  PUMP_STARTED: "bg-emerald-500",
  PUMP_STOPPED: "bg-slate-400",
  TANK_FULL: "bg-sky-500",
  LOW_WATER: "bg-amber-500",
  VOLTAGE_WARNING: "bg-rose-500",
  DRY_RUN: "bg-rose-500",
  SENSOR_FAULT: "bg-rose-500",
  DEVICE_OFFLINE: "bg-slate-400",
};

export function RecentEventsPanel({ events }: { events: DeviceEvent[] }) {
  const recent = events.slice(0, 6);

  return (
    <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-600">Recent Events</h2>
        <Link
          href="/events"
          className="text-xs font-semibold text-sky-700 hover:underline"
        >
          View all
        </Link>
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-slate-500">No events recorded yet.</p>
      ) : (
        <ol className="relative space-y-0 border-l-2 border-sky-100 pl-4">
          {recent.map((e) => (
            <li key={e.id} className="relative pb-4 last:pb-0">
              <span
                className={`absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white ${DOT[e.type]}`}
                aria-hidden
              />
              <p className="text-[11px] font-medium text-slate-400">{formatClock(e.createdAt)}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-slate-800">{e.message}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE[e.type]}`}>
                  {e.type.replace(/_/g, " ")}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
