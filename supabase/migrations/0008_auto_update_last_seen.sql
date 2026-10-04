-- Function to update last_seen to now()
create or replace function public.update_device_last_seen()
returns trigger
language plpgsql
as $$
begin
  NEW.last_seen = now();
  -- If telemetry is being updated, we can also update last_telemetry_at and last_heartbeat_at if they were null or if we want to force them.
  -- But for now, just updating last_seen is enough to keep the device online.
  return NEW;
end;
$$;

-- Add trigger to device_registry
create trigger update_device_registry_last_seen
  before update on public.device_registry
  for each row
  execute function public.update_device_last_seen();
