export function NoDeviceRegistered() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold text-slate-900">No device registered</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your account is not linked to an AquaGuard device yet. Provision a device and assign it to
          your account to view telemetry and send commands.
        </p>
      </div>
    </main>
  );
}
