-- Migration 0006: Per-Device Token Provisioning
--
-- Fixes and extends the device_tokens table from migration 0002:
--
-- 1. token_hash should store SHA-256(token), not the raw token.
--    The ingest route now hashes the incoming Bearer value before lookup,
--    so existing raw-token rows must be re-hashed or reprovisioned.
--
-- 2. device_tokens.device_id references public.devices(id) (UUID), which
--    requires the device to already have a user-owned row. But ESP32s can
--    self-register as text IDs in device_registry before any user claims
--    them. Add a registry_device_id text column so tokens can be issued
--    against a device_registry row directly.
--
-- 3. Add a human-readable label column for operator reference (replaces
--    the generic "ESP32 Ingest Key" description).
--
-- NOTE: After applying this migration, re-provision all existing tokens
-- using the /api/admin/provision-device-token endpoint, which hashes tokens
-- correctly. Any rows inserted with plaintext token_hash values are invalid.

-- 2a. Add registry_device_id (text) — nullable; used when the device has
--     not yet been claimed by a user (no row in public.devices).
alter table public.device_tokens
  add column if not exists registry_device_id text
    references public.device_registry(device_id) on delete cascade;

-- 2b. Make device_id nullable so tokens can be issued for registry-only devices.
--     Existing rows that reference devices.id are unaffected.
alter table public.device_tokens
  alter column device_id drop not null;

-- 3. Constraint: at least one of device_id or registry_device_id must be set.
alter table public.device_tokens
  add constraint device_tokens_has_device_ref
  check (
    device_id is not null
    or registry_device_id is not null
  );

-- 4. Index on registry_device_id for fast token lookup by text device ID.
create index if not exists idx_device_tokens_registry_id
  on public.device_tokens(registry_device_id)
  where revoked_at is null;

-- 5. Allow service-role to insert tokens (provisioning endpoint uses service role).
--    No anon/browser insert policy — provisioning is admin-only server-side.

-- ─── Helper view: resolved device ID for a token ────────────────────────────
-- Returns the effective device ID string regardless of whether the token was
-- issued against a devices UUID or a device_registry text ID.
create or replace view public.device_token_resolved as
  select
    dt.id,
    dt.token_hash,
    dt.revoked_at,
    dt.created_at,
    dt.description,
    coalesce(
      dt.registry_device_id,
      dt.device_id::text
    ) as effective_device_id
  from public.device_tokens dt;

-- RLS note: this view inherits the RLS of device_tokens; service role bypasses it.
