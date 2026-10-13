alter table public.fleet_cte_documents
  add column cargo_weight numeric(16,3)
    check (cargo_weight is null or cargo_weight >= 0),
  add column cargo_weight_unit text
    check (cargo_weight_unit is null or cargo_weight_unit in ('kg', 't'));