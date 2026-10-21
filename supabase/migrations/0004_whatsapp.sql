-- Ember & Co. — migration 0004: WhatsApp number for the floating site button.
-- Nullable on purpose: NULL hides the WhatsApp button on the website.
-- Idempotent — safe to run more than once.
alter table public.restaurant_settings
  add column if not exists whatsapp_number text;
