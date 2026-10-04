import { Fault } from "@/types/device";
import { DisplayConnection } from "@/lib/device/staleness";
import { FAULT_LABEL } from "./presentation";

export function SystemHealthCard({
  fault,
  dryRun,
  connection,
}: {
  fault: Fault;
  dryRun: boolean;
  connection: DisplayConnection;
}) {
  const offline = connection === "OFFLINE";
  const stale = connection === "STALE";
  const hasFault = Boolean(fault || dryRun);

  let title = "Good";
  let detail = "All systems normal";
  let tone: "ok" | "warn" | "danger" | "offline" = "ok";

  if (offline) {
    title = "Offline";
    detail = "Live telemetry unavailable";
    tone = "offline";
  } else if (stale) {
    title = "Stale";
    detail = "Live telemetry unavailable to confirm health";
    tone = "warn";
  } else if (hasFault) {
    title = "Fault";
    detail = fault ? FAULT_LABEL[fault] : "Dry run / no water delivery detected";
    tone = "danger";
  }

  const wrap =
    tone === "ok"
      ? "border-emerald-100"
      : tone === "danger"
        ? "border-red-200"
        : tone === "warn"
          ? "border-amber-200"
          : "border-slate-200";
  const icon =
    tone === "ok"
      ? "bg-emerald-100 text-emerald-600"
      : tone === "danger"
        ? "bg-red-100 text-red-600"
        : tone === "warn"
          ? "bg-amber-100 text-amber-600"
          : "bg-slate-100 text-slate-500";

  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-card ${wrap}`}>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${icon}`}>
          <ShieldIcon />
        </span>
        System Health
      </div>
      <p
        className={`text-2xl font-semibold ${
          tone === "ok"
            ? "text-status-ok"
            : tone === "danger"
              ? "text-status-danger"
              : tone === "warn"
                ? "text-status-warn"
                : "text-status-offline"
        }`}
      >
        {title}
      </p>
      <p className="text-sm text-slate-600">{detail}</p>
    </article>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3 5 6v6c0 5 3.5 7.5 7 9 3.5-1.5 7-4 7-9V6l-7-3z" />
    </svg>
  );
}
