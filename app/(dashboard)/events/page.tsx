import { getPrimaryDevice } from "@/lib/device/resolution.server";
import { EventsClient } from "@/components/events/EventsClient";
import { NoDeviceRegistered } from "@/components/device/NoDeviceRegistered";

export default async function EventsPage() {
  const device = await getPrimaryDevice();

  if (!device) {
    return <NoDeviceRegistered />;
  }

  return <EventsClient deviceId={device.id} deviceName={device.name} />;
}
