-- Migration 0003: ESP32 Discovery, STM32 UART Status, Firmware Version & Staleness

-- 1. Extend device_state table with firmware_version, stm32_connected, last_telemetry_at
alter table public.device_state
  add column if not exists firmware_version text default '1.0.0',
  add column if not exists stm32_connected boolean not null default false,
  add column if not exists last_telemetry_at timestamptz;

-- 2. Update device_status constraint to support STALE state alongside ONLINE and OFFLINE
alter table public.device_state
  drop constraint if exists device_state_device_status_check;

alter table public.device_state
  add constraint device_state_device_status_check
  check (device_status in ('ONLINE', 'STALE', 'OFFLINE'));

-- 3. Indexes for device discovery queries
create index if not exists idx_device_state_status_seen
  on public.device_state(device_status, last_seen desc);
