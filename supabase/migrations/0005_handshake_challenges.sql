-- Migration 0005: Live Handshake Challenges
--
-- Enables a genuine challenge/response handshake during Connect Mode.
-- The backend writes a short-lived nonce to this table; the ESP32 must
-- echo it back via POST /api/device/ingest { type: "challenge_response" }
-- within CHALLENGE_TTL_SECONDS (default 15s) for the handshake to succeed.
--
-- Without this, the handshake only checks database freshness (last_seen),
-- which proves the device was recently alive but not that it is alive RIGHT NOW.
-- With this table, the handshake issues a live probe and waits for the echo.

create table if not exists public.device_challenges (
  id           uuid primary key default gen_random_uuid(),
  device_id    text not null,
  nonce        text not null unique,        -- random hex the ESP32 must echo back
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,        -- issued_at + TTL
  responded_at timestamptz,                 -- set when ESP32 echoes the nonce
  response_ok  boolean not null default false
);

-- Service role only — no RLS public access needed; all access is server-side
alter table public.device_challenges enable row level security;

-- Fast lookup: find the latest open challenge for a device
create index if not exists idx_device_challenges_device_nonce
  on public.device_challenges(device_id, nonce)
  where responded_at is null;

-- Auto-clean challenges older than 5 minutes (keep table small)
-- In production add a pg_cron job; for now rely on application-level cleanup.
create index if not exists idx_device_challenges_expires
  on public.device_challenges(expires_at);
