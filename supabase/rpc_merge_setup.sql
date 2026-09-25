-- Fixes the "data gets wiped / confirmed payments pop back up" bug.
--
-- Root cause: the app used to push the ENTIRE data column on every save,
-- filling in any field it wasn't touching from whatever was in that
-- browser's memory at the time. If two people saved close together, the
-- one who saved last silently overwrote the other's recent change
-- (settlement confirmations included) with stale data.
--
-- Fix: this function merges only the fields actually being changed into
-- the row, atomically, in the database — so a save from one device can
-- never revert fields it isn't touching, no matter how stale its local
-- copy of the rest of the row is.
--
-- Run this once in the Supabase SQL Editor.

create or replace function merge_cook_ledger_data(row_id text, patch jsonb)
returns void
language plpgsql
as $$
begin
  insert into cook_ledger (id, data, updated_at)
  values (row_id, patch, now())
  on conflict (id) do update
    set data = cook_ledger.data || excluded.data,
        updated_at = now();
end;
$$;

grant execute on function merge_cook_ledger_data(text, jsonb) to anon, authenticated;
