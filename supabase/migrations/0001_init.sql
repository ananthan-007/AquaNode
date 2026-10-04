-- AquaGuard schema: devices, device_state, commands, events.
-- Current state is stored separately from historical events (Phase 7 rule):
-- device_state is a single row per device, updated in place; events is
-- append-only for notable transitions only, never every sensor sample.

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'AquaGuard',
  created_at timestamptz not null default now()
);

create table if not exists public.device_state (
  device_id uuid primary key references public.devices(id) on delete cascade,
  water_level int not null check (water_level between 0 and 100),
  voltage numeric not null,
  voltage_state text not null check (voltage_state in ('NORMAL','UNDER_VOLTAGE','OVER_VOLTAGE')),
  pump_state text not null check (pump_state in ('ON','OFF')),
  mode text not null check (mode in ('AUTO','MANUAL')),
  dry_run boolean not null default false,
  fault text,
  device_status text not null check (device_status in ('ONLINE','OFFLINE')),
  last_seen timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sequence bigint not null default 0
);

create table if not exists public.commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  type text not null check (type in ('PUMP_ON','PUMP_OFF','SET_MODE_AUTO','SET_MODE_MANUAL','FAULT_RESET','REQUEST_LEVEL')),
  status text not null default 'PENDING' check (status in ('PENDING','RECEIVED','EXECUTED','REJECTED','FAILED')),
  reason text,
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  type text not null check (type in ('PUMP_STARTED','PUMP_STOPPED','TANK_FULL','LOW_WATER','VOLTAGE_WARNING','DRY_RUN','SENSOR_FAULT','DEVICE_OFFLINE')),
  message text not null,
  created_at timestamptz not null default now()
);

-- ---------- Row Level Security ----------
alter table public.devices enable row level security;
alter table public.device_state enable row level security;
alter table public.commands enable row level security;
alter table public.events enable row level security;

create policy "devices: owner read" on public.devices
  for select using (owner_id = auth.uid());

create policy "devices: owner insert" on public.devices
  for insert with check (owner_id = auth.uid());

create policy "device_state: owner read" on public.device_state
  for select using (
    device_id in (select id from public.devices where owner_id = auth.uid())
  );

-- No client-side update/insert policy on device_state: only a trusted,
-- server-side ingest endpoint may write device state. Per confirmed
-- architecture, the ESP32 never holds Supabase credentials of any kind — it
-- authenticates to that server-side endpoint with a per-device secret via
-- `Authorization: Bearer <DEVICE_TOKEN>`. That endpoint (not the ESP32) is
-- the only thing with elevated write access to this table. The frontend/
-- anon-key browser client can never modify device_state either way.

create policy "commands: owner read" on public.commands
  for select using (
    device_id in (select id from public.devices where owner_id = auth.uid())
  );

create policy "commands: owner insert" on public.commands
  for insert with check (
    requested_by = auth.uid()
    and device_id in (select id from public.devices where owner_id = auth.uid())
  );

-- No client update policy on commands: status transitions (RECEIVED,
-- EXECUTED, REJECTED, FAILED) are only ever written by the trusted backend
-- path relaying STM32/ESP32 results, never by the browser client.

create policy "events: owner read" on public.events
  for select using (
    device_id in (select id from public.devices where owner_id = auth.uid())
  );

-- ---------- Manual RLS test checklist (run against a real project) ----------
-- 1. As user A, insert a device; as user B, confirm `select * from devices`
--    does not return user A's row.
-- 2. As user B, attempt `insert into commands (device_id, ...)` referencing
--    user A's device_id — must fail the insert policy.
-- 3. Confirm anon/browser client cannot update device_state or commands.status
--    at all (no policy grants it) — only the trusted server-side ingest
--    endpoint (authenticated via the ESP32's per-device Bearer token, not a
--    key held by the ESP32 itself) can.
