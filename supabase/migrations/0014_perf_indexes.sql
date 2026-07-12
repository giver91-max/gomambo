-- Postgres does not auto-index the referencing side of a foreign key —
-- only columns already covered by a unique constraint (car_availability,
-- favorites, admin_conversations, and the leftmost column of
-- conversations'/admin_notification_reads' composite uniques) are indexed
-- today. Everything else here is filtered on in the app without an index,
-- meaning a full table scan per query.
create index if not exists idx_cars_owner_id on public.cars(owner_id);
create index if not exists idx_car_images_car_id on public.car_images(car_id);
create index if not exists idx_bookings_car_id on public.bookings(car_id);
create index if not exists idx_bookings_owner_id on public.bookings(owner_id);
create index if not exists idx_bookings_renter_id on public.bookings(renter_id);
create index if not exists idx_conversations_owner_id on public.conversations(owner_id);
create index if not exists idx_conversations_renter_id on public.conversations(renter_id);
create index if not exists idx_messages_conversation_id on public.messages(conversation_id);
create index if not exists idx_admin_chat_messages_conversation_id on public.admin_chat_messages(conversation_id);
create index if not exists idx_admin_notification_reads_user_id on public.admin_notification_reads(user_id);
