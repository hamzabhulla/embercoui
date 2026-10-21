-- Ember & Co. — migration 0007: supporting indexes for the admin lists.
-- The admin Orders / Reservations / Customers / Newsletter screens page
-- through their tables (limit/offset with exact totals), the dashboard
-- and finance reports scan orders by creation time, and the
-- Reservations day board filters bookings by date + status. Without
-- these indexes those queries seq-scan as the tables grow.
-- (orders (user_id, created_at desc) already exists from 0001 as
-- orders_user_idx, so it is not repeated here.)
-- Idempotent — safe to run more than once. Performance-only: the app
-- behaves identically before this runs, just slower at scale.

create index if not exists reservations_date_status_idx
  on public.reservations (reservation_date, status);

create index if not exists menu_items_available_category_sort_idx
  on public.menu_items (is_available, category, sort_order);

create index if not exists orders_created_at_idx
  on public.orders (created_at desc);
