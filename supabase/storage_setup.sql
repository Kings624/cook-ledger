-- One-time setup for the receipt-photo upload feature.
-- Run this in the Supabase SQL Editor after creating the "receipts" bucket
-- (Storage → New bucket → name it "receipts", uncheck "Public bucket" is fine
-- either way since these policies open it up to the anon key like the rest
-- of the app's data).

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

create policy "Allow anon read receipts"
  on storage.objects for select
  using (bucket_id = 'receipts');

create policy "Allow anon upload receipts"
  on storage.objects for insert
  with check (bucket_id = 'receipts');

create policy "Allow anon delete receipts"
  on storage.objects for delete
  using (bucket_id = 'receipts');
