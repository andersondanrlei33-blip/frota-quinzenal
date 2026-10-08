alter table public.fleet_cte_documents
  add column participant_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(participant_details) = 'object');

create table public.fleet_cte_report_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.fleet_companies(id) on delete cascade,
  visible_columns text[] not null check (cardinality(visible_columns) > 0),
  column_order text[] not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

alter table public.fleet_cte_report_preferences enable row level security;
revoke all on public.fleet_cte_report_preferences from anon, authenticated;
grant all on public.fleet_cte_report_preferences to service_role;
