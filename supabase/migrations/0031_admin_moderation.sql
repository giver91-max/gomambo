-- Soft-delete support so admin can moderate messages/notifications/reviews
-- without destroying content that may matter as evidence in a payment or
-- deposit dispute (see the Stripe deposit-capture flow). Deletion is
-- implemented as an UPDATE (set deleted_at) through the admin service-role
-- client — the same pattern already used for cross-user admin actions like
-- deleteUserAccount — so no new RLS policies are needed for these columns.
alter table public.messages add column deleted_at timestamptz;
alter table public.admin_chat_messages add column deleted_at timestamptz;
alter table public.notifications add column deleted_at timestamptz;
alter table public.admin_notifications add column deleted_at timestamptz;
alter table public.reviews add column deleted_at timestamptz;
