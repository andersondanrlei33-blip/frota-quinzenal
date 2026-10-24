alter table public.fleet_cte_requests
  drop constraint fleet_cte_requests_status_check;

alter table public.fleet_cte_requests
  add constraint fleet_cte_requests_status_check
  check (status in ('pending', 'issued', 'cancelled', 'rejected'));

alter table public.fleet_cte_requests
  drop constraint fleet_cte_requests_check;

alter table public.fleet_cte_requests
  add constraint fleet_cte_requests_document_status_check
  check (cte_document_id is null or status in ('issued', 'rejected'));

alter table public.fleet_cte_requests
  add column rejection_reason text,
  add column rejected_at timestamptz,
  add column rejected_by uuid references auth.users(id),
  add constraint fleet_cte_requests_rejection_fields_check check (
    (status = 'rejected'
      and rejection_reason is not null
      and length(btrim(rejection_reason)) between 3 and 500
      and rejected_at is not null
      and rejected_by is not null)
    or
    (status <> 'rejected'
      and rejection_reason is null
      and rejected_at is null
      and rejected_by is null)
  );
