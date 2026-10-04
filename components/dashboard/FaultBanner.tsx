import { Fault } from "@/types/device";
import { FAULT_LABEL } from "./presentation";

export function FaultBanner({ fault, dryRun }: { fault: Fault; dryRun: boolean }) {
  if (!fault && !dryRun) return null;

  const label = fault ? FAULT_LABEL[fault] : "Dry run / no water delivery detected";

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-status-danger shadow-card"
    >
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100 font-semibold"
        aria-hidden
      >
        !
      </span>
      <div>
        <p className="font-semibold uppercase tracking-wide">Fault</p>
        <p className="font-medium">{label}</p>
      </div>
    </div>
  );
}
