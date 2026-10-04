import { Command, CommandStatus } from "@/types/device";
import { COMMAND_TYPE_LABEL, formatClock } from "./presentation";

const SUCCESS_STEPS: CommandStatus[] = ["PENDING", "RECEIVED", "EXECUTED"];

export function CommandLifecycle({
  command,
  observedStatuses,
}: {
  command: Command | null;
  observedStatuses: CommandStatus[];
}) {
  if (!command) {
    return (
      <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-card">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-600">Last Command Status</h2>
        <p className="mt-3 text-sm text-slate-500">No command request in this session yet.</p>
      </section>
    );
  }

  const terminal = command.status === "REJECTED" || command.status === "FAILED";
  const sawReceived = observedStatuses.includes("RECEIVED") || command.status === "EXECUTED";

  const steps: CommandStatus[] = terminal
    ? sawReceived
      ? ["PENDING", "RECEIVED", command.status]
      : ["PENDING", command.status]
    : SUCCESS_STEPS;

  const reachedIndex = steps.indexOf(command.status);

  return (
    <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-card" aria-live="polite">
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-600">Last Command Status</h2>
      <p className="mt-1 text-sm font-medium text-slate-800">{COMMAND_TYPE_LABEL[command.type]}</p>

      <ol className="mt-5 flex flex-col gap-0 sm:flex-row sm:items-start sm:justify-between">
        {steps.map((step, i) => {
          const complete = reachedIndex >= 0 && i < reachedIndex;
          const current = step === command.status;
          const pending = reachedIndex === -1 ? i > 0 : i > reachedIndex;
          return (
            <li key={`${step}-${i}`} className="flex flex-1 items-start gap-3 sm:flex-col sm:items-center sm:text-center">
              <div className="flex items-center sm:w-full">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    current && terminal
                      ? "bg-rose-500 text-white"
                      : current
                        ? "bg-sky-500 text-white"
                        : complete
                          ? "bg-emerald-500 text-white"
                          : "bg-slate-200 text-slate-500"
                  }`}
                  aria-current={current ? "step" : undefined}
                >
                  {complete || (current && command.status === "EXECUTED") ? "✓" : current && terminal ? "!" : i + 1}
                </span>
                {i < steps.length - 1 && (
                  <span
                    className={`ml-2 hidden h-0.5 flex-1 sm:block ${complete ? "bg-emerald-400" : "bg-slate-200"}`}
                  />
                )}
              </div>
              <div className={`pb-4 sm:pb-0 sm:pt-2 ${pending ? "text-slate-400" : "text-slate-800"}`}>
                <p className="text-xs font-bold tracking-wide">{step}</p>
                {current && step === "PENDING" && (
                  <p className="text-[11px] text-slate-500">{formatClock(command.createdAt)}</p>
                )}
                {current && step !== "PENDING" && (
                  <p className="text-[11px] text-slate-500">{formatClock(command.updatedAt)}</p>
                )}
                {complete && i === 0 && (
                  <p className="text-[11px] text-slate-400">{formatClock(command.createdAt)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div
        className={`mt-4 rounded-2xl px-3 py-2 text-sm font-medium ${
          command.status === "EXECUTED"
            ? "bg-emerald-50 text-emerald-700"
            : terminal
              ? "bg-rose-50 text-rose-700"
              : "bg-sky-50 text-sky-800"
        }`}
      >
        <p>{statusHeadline(command.status)}</p>
        {command.status === "REJECTED" && command.reason && (
          <p className="mt-1 font-normal text-slate-700">Reason: {command.reason}</p>
        )}
        {command.status === "FAILED" && (
          <p className="mt-1 font-normal text-slate-700">
            {command.reason ?? "Command failed. No additional failure detail was provided."}
          </p>
        )}
      </div>
    </section>
  );
}

function statusHeadline(status: CommandStatus): string {
  switch (status) {
    case "PENDING":
      return "PENDING — request has not been confirmed as received.";
    case "RECEIVED":
      return "RECEIVED — device acknowledged the request. Not yet executed.";
    case "EXECUTED":
      return "EXECUTED — command executed.";
    case "REJECTED":
      return "REJECTED";
    case "FAILED":
      return "FAILED";
  }
}
