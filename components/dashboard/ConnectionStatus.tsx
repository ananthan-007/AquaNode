"use client";

import { useEffect, useState } from "react";
import { DisplayConnection, formatLastSeen } from "@/lib/device/staleness";

export function ConnectionStatus({
  connection,
  lastSeenIso,
  hasFault,
}: {
  connection: DisplayConnection;
  lastSeenIso: string;
  hasFault: boolean;
}) {
  const [lastSeenLabel, setLastSeenLabel] = useState("");

  useEffect(() => {
    setLastSeenLabel(formatLastSeen(lastSeenIso));
  }, [lastSeenIso]);

  const isLive = connection === "ONLINE";
  const isOffline = connection === "OFFLINE";

  const title = isLive ? "ONLINE" : isOffline ? "OFFLINE" : "STALE";
  const description = isLive
    ? hasFault
      ? "Device reporting — see system health"
      : "System is healthy"
    : isOffline
      ? "Live device telemetry unavailable"
      : "Data may not be current";

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-live="polite">
      <div
        className={`flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 shadow-card ${
          isLive ? "border-emerald-100" : isOffline ? "border-slate-200" : "border-amber-200"
        }`}
      >
        <span
          className={`relative flex h-3 w-3 shrink-0 ${
            isLive ? "text-status-ok" : isOffline ? "text-status-offline" : "text-status-warn"
          }`}
          aria-hidden
        >
          <span
            className={`absolute inset-0 rounded-full ${
              isLive ? "bg-status-ok motion-safe:animate-[ag-pulse-dot_1.8s_ease-in-out_infinite]" : isOffline ? "bg-status-offline" : "bg-status-warn"
            }`}
          />
        </span>
        <div>
          <p className="text-sm font-semibold tracking-wide text-slate-900">
            {title}
            <span className="font-medium text-slate-500"> — {description}</span>
          </p>
        </div>
      </div>
      <div className="rounded-2xl border border-sky-100 bg-white px-4 py-3 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-600">Last seen</p>
        <p className="text-sm font-medium text-slate-800">{lastSeenLabel || "\u00a0"}</p>
      </div>
    </section>
  );
}
