-- Migration 0004: ESP32 Open Device Registry
--
-- Problem: Migration 0001 defined device_state.device_id as a UUID FK
-- referencing public.devices(id), which requires a user-owned `devices`
-- row to exist before any ingest can succeed. This prevents the ESP32 from
-- self-registering before a user claims it.
--
-- Solution: Add a `device_registry` table that holds the ESP32's known
-- identity (device_id as text, heartbeats, firmware, UART status) without
-- requiring a user record. The device_state FK remains intact for
-- user-owned devices. The ingest endpoint writes to device_registry (via
-- service-role) regardless of whether a user has claimed the device yet.
--
-- The devices discovery endpoint (GET /api/device/devices) reads from
-- device_registry, not device_state, so unclaimed ESP32s are visible.
-- Once a user claims a device, a row is created in public.devices and
-- device_state, and the ingest route upserts both.

-- 1. Device Registry (ESP32 self-registration, no user required)
create table if not exists public.device_registry (
  device_id text primary key,                  -- stable ESP32 identifier (e.g. AQ-ESP32-AABBCC)
  firmware_version text not null default '1.0.0',
  stm32_connected boolean not null default false,
  last_seen timestamptz not null default now(),
  last_telemetry_at timestamptz,
  last_heartbeat_at timestamptz,
  water_level int,
  voltage numeric,
  voltage_state text check (voltage_state in ('NORMAL','UNDER_VOLTAGE','OVER_VOLTAGE')),
  pump_state text check (pump_state in ('ON','OFF')),
  mode text check (mode in ('AUTO','MANUAL')),
  dry_run boolean default false,
  fault text,
  sequence bigint default 0,
  registered_at timestamptz not null default now(),
  -- owner_id is NULL until a user claims this device
  owner_id uuid references auth.users(id) on delete set null
);

-- RLS: anyone can see registered devices (for discovery), only owner can see sensitive state
alter table public.device_registry enable row level security;

-- Service role (ingest endpoint) bypasses RLS — this policy covers anon/authenticated reads
create policy "device_registry: read unclaimed or owned" on public.device_registry
  for select using (
    owner_id is null or owner_id = auth.uid()
  );

-- Service role handles inserts/updates via the ingest endpoint (no client insert policy)

-- 2. Index for fast discovery queries (sort by last_seen, filter by status)
create index if not exists idx_device_registry_last_seen
  on public.device_registry(last_seen desc);

-- 3. Device claim table — links a device_registry row to an owner
create table if not exists public.device_claims (
  id uuid primary key default gen_random_uuid(),
  device_id text not null references public.device_registry(device_id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  unique(device_id)
);

alter table public.device_claims enable row level security;

create policy "device_claims: owner read" on public.device_claims
  for select using (owner_id = auth.uid());

create policy "device_claims: owner insert" on public.device_claims
  for insert with check (owner_id = auth.uid());
