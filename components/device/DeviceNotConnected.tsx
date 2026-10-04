"use client";

/**
 * DeviceNotConnected — shown when no hardware provider is active.
 * Replaces the old simulator fallback. Guides the user to connect
 * their real AquaGuard ESP32 via the hidden developer panel.
 */

interface DeviceNotConnectedProps {
  /** Short blurb shown under the main message (optional). */
  hint?: string;
}

export function DeviceNotConnected({ hint }: DeviceNotConnectedProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      {/* Icon */}
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100">
        <svg
          viewBox="0 0 24 24"
          className="h-10 w-10 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* Chip / controller icon */}
          <rect x="7" y="7" width="10" height="10" rx="1" />
          <path d="M7 9H5M7 12H5M7 15H5M17 9h2M17 12h2M17 15h2M9 7V5M12 7V5M15 7V5M9 17v2M12 17v2M15 17v2" />
          {/* Diagonal disconnection line */}
          <line x1="4" y1="4" x2="20" y2="20" strokeWidth="1.5" />
        </svg>
      </div>

      {/* Heading */}
      <h2 className="mb-2 text-xl font-bold tracking-tight text-slate-800">
        Device Not Connected
      </h2>

      {/* Sub-text */}
      <p className="mb-1 max-w-sm text-sm leading-relaxed text-slate-500">
        {hint ??
          "Your AquaGuard device is not connected to the dashboard. Power on your ESP32 and connect using the hardware panel."}
      </p>

      {/* How-to hint */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-left">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">
          How to Connect
        </p>
        <ol className="space-y-1.5 text-xs text-slate-600">
          <li className="flex gap-2">
            <span className="font-bold text-slate-800">1.</span>
            Power on your ESP32 and ensure it is connected to Wi-Fi.
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-slate-800">2.</span>
            Press <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[10px]">Space</kbd>{" "}
            five times rapidly to open the hardware panel.
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-slate-800">3.</span>
            Select your device and click <strong>Connect</strong>.
          </li>
        </ol>
      </div>
    </div>
  );
}
