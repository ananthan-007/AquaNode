import { getPrimaryDevice } from "@/lib/device/resolution.server";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { NoDeviceRegistered } from "@/components/device/NoDeviceRegistered";

export default async function DashboardPage() {
  const device = await getPrimaryDevice();

  if (!device) {
    return <NoDeviceRegistered />;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">System monitor</h1>
        <p className="text-sm text-slate-500">
          Live reported state and command requests — {device.name}
        </p>
      </div>
      <DashboardClient deviceId={device.id} />
    </main>
  );
}
