-- Ember & Co. — migration 0011: money storage precision.
-- Every money column was created as numeric(10, 2) in 0001, but the
-- platform trades in any ISO 4217 currency (migration 0003) and seven of
-- them — KWD, BHD, OMR, JOD, TND, IQD, LYD — have a minor unit of 1/1000.
-- The backend's money math is exact for those currencies (integer minor
-- units at the ISO exponent, so a 1.005 KWD dish totals exactly 3.015 at
-- quantity 3), but Postgres silently ROUNDS a 3-decimal value on write to
-- a numeric(…, 2) column — the stored order, the finance reports and the
-- customer's receipt would permanently disagree with the amount actually
-- charged, by fils-level amounts on a large share of orders.
-- This migration widens every money column to numeric(12, 3): a safe
-- superset for 0-, 2- and 3-decimal currencies. Widening is exact — every
-- value a numeric(10, 2) column can hold is representable in
-- numeric(12, 3) unchanged — so existing data is preserved bit-for-bit.
-- Columns widened:
--   menu_items.price, orders.subtotal, orders.delivery_fee,
--   orders.discount, orders.total, order_items.unit_price,
--   coupons.value (money when the coupon type is 'fixed'; harmless for
--   'percent', whose values stay well inside the wider precision).
-- Idempotent — safe to run more than once: each column is only altered
-- when its current precision/scale is not already (12, 3), so a second
-- run is a no-op. Until this runs, a shop trading in a 3-decimal currency
-- still rounds at storage — the code computes exactly, the column does
-- not; nothing in the app pretends otherwise.

do $$
declare
  col record;
begin
  for col in
    select * from (values
      ('menu_items', 'price'),
      ('orders', 'subtotal'),
      ('orders', 'delivery_fee'),
      ('orders', 'discount'),
      ('orders', 'total'),
      ('order_items', 'unit_price'),
      ('coupons', 'value')
    ) as t (table_name, column_name)
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = col.table_name
        and column_name = col.column_name
        and not (numeric_precision = 12 and numeric_scale = 3)
    ) then
      execute format(
        'alter table public.%I alter column %I type numeric(12, 3)',
        col.table_name, col.column_name
      );
    end if;
  end loop;
end $$;

-- Make PostgREST pick the new column types up immediately.
notify pgrst, 'reload schema';
