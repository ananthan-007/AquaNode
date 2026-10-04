import { DeviceEvent } from "@/types/device";

export function EventList({ events }: { events: DeviceEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-500">No events recorded yet.</p>;
  }

  return (
    <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
      {events.map((e) => (
        <li key={e.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium text-slate-800">{e.type.replace(/_/g, " ")}</div>
            <div className="text-slate-500">{e.message}</div>
          </div>
          <span className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
