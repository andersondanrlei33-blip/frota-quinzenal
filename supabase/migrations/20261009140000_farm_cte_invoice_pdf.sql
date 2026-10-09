alter table public.fleet_cte_requests
  drop constraint if exists fleet_cte_requests_invoice_files_check;

alter table public.fleet_cte_requests
  add constraint fleet_cte_requests_invoice_files_check
  check (jsonb_typeof(invoice_files) = 'array' and jsonb_array_length(invoice_files) <= 20);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fleet-cte-invoices', 'fleet-cte-invoices', false, 10485760, array['application/xml', 'text/xml', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
