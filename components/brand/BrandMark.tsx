export function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-11 w-11" : "h-9 w-9";
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <span className={`relative ${box} shrink-0 text-slate-800`} aria-hidden>
        <svg viewBox="0 0 40 40" className="h-full w-full" fill="none">
          <rect x="6" y="4" width="28" height="5" rx="1" fill="currentColor" />
          <path
            d="M8 9h24v18c0 1.2-.8 2-2 2H10c-1.2 0-2-.8-2-2V9z"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
          />
          <path d="M10 21h20v6c0 .6-.4 1-1 1H11c-.6 0-1-.4-1-1v-6z" fill="#0284c7" />
          <path d="M32 16h4v3h-2v6h-4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="min-w-0 leading-tight">
        <span className={`block font-semibold tracking-[0.14em] text-slate-900 ${size === "lg" ? "text-lg" : "text-sm"}`}>
          AQUAGUARD
        </span>
        <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
          Level · Voltage · Pump
        </span>
      </span>
    </span>
  );
}
