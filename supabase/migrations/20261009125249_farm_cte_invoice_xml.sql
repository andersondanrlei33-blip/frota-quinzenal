alter table public.fleet_cte_requests
  add column invoice_files jsonb not null default '[]'::jsonb
  check (jsonb_typeof(invoice_files) = 'array' and jsonb_array_length(invoice_files) <= 10);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fleet-cte-invoices', 'fleet-cte-invoices', false, 10485760, array['application/xml', 'text/xml'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
