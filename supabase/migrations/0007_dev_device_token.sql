-- Migration 0007: Development ESP32 Device Token
--
-- Provisions a token for the single development/bench-test ESP32 unit.
-- This token is for USE IN DEVELOPMENT ONLY — it may be used against any
-- backend running with NODE_ENV != "production".
--
-- ┌──────────────────────────────────────────────────────────────────────┐
-- │  DEVELOPMENT DEVICE CONFIGURATION                                    │
-- │                                                                      │
-- │  Registry Device ID:  AQ-ESP32-DEV000000001                         │
-- │                       (or the actual MAC-derived ID once flashed)    │
-- │                                                                      │
-- │  Raw token (set as DEVICE_TOKEN in firmware):                        │
-- │  13e4b82a975563620ab3597132ca3c32fa3f499805934e3d457441afaaa8fee0   │
-- │                                                                      │
-- │  Token hash stored in DB (SHA-256 of above):                        │
-- │  a21d2f275d7ab73bd6f2b98da466b399e0e2d63c9f4b18f123265dfd8f1b845c  │
-- │                                                                      │
-- │  Description: AquaGuard ESP32 - Development Unit 1                  │
-- │                                                                      │
-- │  To use this token in firmware:                                      │
-- │    #define DEVICE_TOKEN                                              │
-- │      "13e4b82a975563620ab3597132ca3c32fa3f499805934e3d457441afaaa8fee0"
-- │                                                                      │
-- │  NEVER use this token against a production backend.                  │
-- │  NEVER commit DEVICE_TOKEN values to Git.                            │
-- └──────────────────────────────────────────────────────────────────────┘
--
-- Steps to apply:
--
-- 1. Run this migration against your Supabase project.
--
-- 2. The device_registry row is created automatically when the ESP32 sends
--    its first heartbeat. If you want to pre-create it for testing:
--
--    INSERT INTO public.device_registry (device_id, firmware_version)
--    VALUES ('AQ-ESP32-DEV000000001', '1.0.0')
--    ON CONFLICT (device_id) DO NOTHING;
--
-- 3. Update DEVICE_TOKEN in hardware/esp32/aquaguard_esp32.ino to the
--    raw token value above before flashing.
--
-- 4. For production units, use POST /api/admin/provision-device-token
--    instead of this migration — each unit gets its own unique token.

-- Insert the dev device_registry row (no-op if already exists from heartbeat).
insert into public.device_registry (device_id, firmware_version, stm32_connected)
values ('AQ-ESP32-DEV000000001', '1.0.0', false)
on conflict (device_id) do nothing;

-- Insert the token (hash only — raw token is never stored).
insert into public.device_tokens (
  registry_device_id,
  device_id,
  token_hash,
  description
) values (
  'AQ-ESP32-DEV000000001',
  null,
  'a21d2f275d7ab73bd6f2b98da466b399e0e2d63c9f4b18f123265dfd8f1b845c',
  'AquaGuard ESP32 - Development Unit 1'
)
on conflict (token_hash) do nothing;
