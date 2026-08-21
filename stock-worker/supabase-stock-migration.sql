create policy "stock history public read"
on stock_history for select
to anon, authenticated
using (true);

create index if not exists inventory_needoh_retailer_idx
on inventory (needoh_id, retailer_id);

create index if not exists inventory_verified_at_idx
on inventory (verified_at desc);

create index if not exists stock_history_inventory_checked_idx
on stock_history (inventory_id, checked_at desc);
