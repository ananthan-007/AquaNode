-- Migration 0002: Hardware Ingest, Device Tokens, and Database Performance Indexes

-- 1. Device Tokens table for physical ESP32 Bearer Authentication
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  token_hash text not null unique,
  description text default 'ESP32 Ingest Key',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- RLS on device_tokens: only service key / server environment can access token hashes
alter table public.device_tokens enable row level security;

-- Owner can view tokens for their devices (metadata, not used for direct token checks)
create policy "device_tokens: owner read" on public.device_tokens
  for select using (
    device_id in (select id from public.devices where owner_id = auth.uid())
  );

-- Owner can insert token requests for their devices
create policy "device_tokens: owner insert" on public.device_tokens
  for insert with check (
    device_id in (select id from public.devices where owner_id = auth.uid())
  );

-- 2. Indexes for efficient high-frequency querying
create index if not exists idx_device_tokens_hash on public.device_tokens(token_hash) where revoked_at is null;
create index if not exists idx_device_state_updated_at on public.device_state(updated_at desc);
create index if not exists idx_commands_device_status on public.commands(device_id, status);
create index if not exists idx_events_device_created on public.events(device_id, created_at desc);
