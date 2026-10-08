create table public.fleet_cte_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.fleet_companies(id) on delete cascade,
  farm_id text not null,
  farm_name text not null check(length(farm_name) between 1 and 80),
  truck_id text not null,
  plate text not null check(length(plate) between 1 and 8),
  driver text not null check(length(driver) between 1 and 100),
  cte_number text check(cte_number is null or length(cte_number) between 1 and 40),
  issued_on date not null,
  uploaded_by uuid not null references auth.users(id),
  object_key text not null unique,
  file_name text not null check(length(file_name) between 1 and 160),
  content_type text not null check(content_type in ('application/pdf','application/xml')),
  size_bytes integer not null check(size_bytes between 1 and 20971520),
  created_at timestamptz not null default now(),
  check(object_key like company_id::text || '/ctes/%')
);

create index fleet_cte_documents_company_date_idx
  on public.fleet_cte_documents(company_id, issued_on desc, created_at desc);
create index fleet_cte_documents_company_plate_idx
  on public.fleet_cte_documents(company_id, plate);
create unique index fleet_cte_documents_company_number_idx
  on public.fleet_cte_documents(company_id, cte_number)
  where cte_number is not null;

alter table public.fleet_cte_documents enable row level security;
revoke all on public.fleet_cte_documents from anon, authenticated;
grant all on public.fleet_cte_documents to service_role;

update storage.buckets
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = array['application/pdf','image/jpeg','image/png','application/xml','text/xml']
where id = 'fleet-receipts';
