import { DeviceState } from "@/types/device";
import { DisplayConnection } from "@/lib/device/staleness";
import { VoltageCard } from "./VoltageCard";
import { PumpStateCard } from "./PumpStateCard";
import { SystemHealthCard } from "./SystemHealthCard";

export function MetricsStrip({
  state,
  connection,
  stale,
}: {
  state: DeviceState;
  connection: DisplayConnection;
  stale: boolean;
}) {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <VoltageCard voltage={state.voltage} voltageState={state.voltageState} stale={stale} />
      <PumpStateCard pumpState={state.pumpState} stale={stale} />
      <SystemHealthCard
        fault={state.fault}
        dryRun={state.dryRun}
        connection={connection}
      />
    </section>
  );
}
