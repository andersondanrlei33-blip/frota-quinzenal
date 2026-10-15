alter table public.fleet_cte_requests
  drop constraint fleet_cte_requests_status_check;

alter table public.fleet_cte_requests
  add constraint fleet_cte_requests_status_check
  check (status in ('pending', 'issued', 'cancelled'));
