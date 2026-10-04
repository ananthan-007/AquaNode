"use client";

import { useEffect, useState } from "react";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "aquaguard-level-24h:";

type Sample = { t: number; level: number };

function clampLevel(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function loadSamples(deviceId: string, now: number): Sample[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + deviceId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is Sample => {
        return (
          !!s &&
          typeof s === "object" &&
          typeof (s as Sample).t === "number" &&
          typeof (s as Sample).level === "number" &&
          Number.isFinite((s as Sample).t) &&
          Number.isFinite((s as Sample).level)
        );
      })
      .map((s) => ({ t: s.t, level: clampLevel(s.level) }))
      .filter((s) => now - s.t <= WINDOW_MS)
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

function saveSamples(deviceId: string, samples: Sample[]) {
  try {
    localStorage.setItem(STORAGE_PREFIX + deviceId, JSON.stringify(samples));
  } catch {
    // Ignore quota / private-mode failures; the chart still works in-memory.
  }
}

export function LevelTrend24h({
  deviceId,
  waterLevel,
  lastSeen,
  stale,
  isSimulated = false,
}: {
  deviceId: string;
  waterLevel: number;
  lastSeen: string;
  stale: boolean;
  isSimulated?: boolean;
}) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const n = Date.now();
    setNow(n);
    const reportAt = new Date(lastSeen).getTime();
    const pointTime = Number.isNaN(reportAt) ? n : reportAt;
    const level = clampLevel(waterLevel);

    setSamples(() => {
      const existing = loadSamples(deviceId, n);
      const already = existing.some((s) => s.t === pointTime && s.level === level);
      const next = already
        ? existing
        : [...existing, { t: pointTime, level }].filter((s) => n - s.t <= WINDOW_MS);
      saveSamples(deviceId, next);
      return next;
    });
  }, [deviceId, waterLevel, lastSeen]);

  const start = now === null ? 0 : now - WINDOW_MS;
  const w = 280;
  const h = 118;
  const padL = 28;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const xOf = (t: number) => padL + ((t - start) / WINDOW_MS) * innerW;
  const yOf = (level: number) => padT + ((100 - level) / 100) * innerH;

  const path =
    now === null || samples.length === 0
      ? ""
      : samples
          .map((s, i) => `${i === 0 ? "M" : "L"} ${xOf(s.t).toFixed(1)} ${yOf(s.level).toFixed(1)}`)
          .join(" ");

  const hourLabels =
    now === null
      ? []
      : [0, 6, 12, 18, 24].map((hoursAgo) => {
          const t = now - (24 - hoursAgo) * 60 * 60 * 1000;
          const d = new Date(t);
          const label = d.toLocaleTimeString(undefined, { hour: "numeric" });
          return { hoursAgo, t, label, x: xOf(t) };
        });

  return (
    <div className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-sky-600">Level trend (24h)</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        {isSimulated
          ? "Simulated water level over the last 24 hours. This is browser-session data from the virtual device, not real hardware readings."
          : "Reported water level over the last 24 hours. Each point is a device reading recorded by this browser (timestamp = last seen). No server-side history."}
      </p>

      {now === null ? (
        <div className="mt-4 h-[118px] rounded-xl bg-sky-50" aria-hidden />
      ) : samples.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No reported readings in the last 24 hours yet.</p>
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-auto w-full" role="img" aria-label="24-hour water level trend">
          {[0, 50, 100].map((y) => (
            <g key={y}>
              <line
                x1={padL}
                x2={w - padR}
                y1={yOf(y)}
                y2={yOf(y)}
                stroke="#e0f2fe"
                strokeWidth="1"
              />
              <text x={padL - 4} y={yOf(y) + 3} textAnchor="end" fill="#7dd3fc" fontSize="9">
                {y}
              </text>
            </g>
          ))}
          {path && (
            <path d={path} fill="none" stroke={stale ? "#94a3b8" : "#0ea5e9"} strokeWidth="2.5" strokeLinejoin="round" />
          )}
          {samples.map((s, i) => (
            <circle
              key={`${s.t}-${s.level}-${i}`}
              cx={xOf(s.t)}
              cy={yOf(s.level)}
              r="3"
              fill={stale ? "#94a3b8" : "#0284c7"}
            />
          ))}
          {hourLabels.map((tick) => (
            <text key={tick.hoursAgo} x={tick.x} y={h - 6} textAnchor="middle" fill="#64748b" fontSize="8">
              {tick.label}
            </text>
          ))}
        </svg>
      )}

      <p className={`mt-1 text-xs font-medium tabular-nums ${stale ? "text-slate-400" : "text-sky-900"}`}>
        Current reported: {clampLevel(waterLevel)}%{stale ? " (not live)" : ""}
        {samples.length > 0 ? ` · ${samples.length} reading${samples.length === 1 ? "" : "s"} in window` : ""}
      </p>
    </div>
  );
}
