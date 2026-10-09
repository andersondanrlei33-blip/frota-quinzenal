alter table public.fleet_cte_documents
  add column manifested_notes text[] not null default '{}'::text[]
    check (cardinality(manifested_notes) <= 100);
