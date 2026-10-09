alter table public.fleet_cte_requests
  drop constraint if exists fleet_cte_requests_invoice_keys_check;

alter table public.fleet_cte_requests
  add constraint fleet_cte_requests_invoice_keys_check
  check (
    jsonb_typeof(invoice_keys) = 'array'
    and jsonb_array_length(invoice_keys) <= 100
  );
