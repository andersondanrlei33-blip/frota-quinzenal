create table public.fleet_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  revision bigint not null default 0 check (revision >= 0),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fleet_members (
  company_id uuid not null references public.fleet_companies(id),
  user_id uuid not null references auth.users(id),
  email text not null,
  role text not null check (role in ('admin','operator','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id,user_id)
);
create index fleet_members_user_idx on public.fleet_members(user_id,active);

create table public.fleet_records (
  company_id uuid not null references public.fleet_companies(id),
  kind text not null check (kind in ('farm','truck','discount','closing')),
  record_id text not null check (length(record_id) between 1 and 200),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (company_id,kind,record_id)
);

create table public.fleet_audit (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.fleet_companies(id),
  actor_id uuid not null references auth.users(id),
  action text not null,
  revision bigint not null,
  changes jsonb not null,
  created_at timestamptz not null default now()
);
create index fleet_audit_company_idx on public.fleet_audit(company_id,id desc);

create table public.fleet_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.fleet_companies(id),
  email text not null,
  role text not null check (role in ('admin','operator','viewer')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index fleet_invitations_company_idx on public.fleet_invitations(company_id,created_at desc);

alter table public.fleet_companies enable row level security;
alter table public.fleet_members enable row level security;
alter table public.fleet_records enable row level security;
alter table public.fleet_audit enable row level security;
alter table public.fleet_invitations enable row level security;

revoke all on public.fleet_companies,public.fleet_members,public.fleet_records,public.fleet_audit,public.fleet_invitations from anon,authenticated;
grant select on public.fleet_companies,public.fleet_members,public.fleet_records to authenticated;
grant all on public.fleet_companies,public.fleet_members,public.fleet_records,public.fleet_audit,public.fleet_invitations to service_role;
grant usage,select on sequence public.fleet_audit_id_seq to service_role;

create policy fleet_members_self_read on public.fleet_members for select to authenticated
  using (user_id = (select auth.uid()) and active);
create policy fleet_companies_member_read on public.fleet_companies for select to authenticated
  using (exists(select 1 from public.fleet_members m where m.company_id=id and m.user_id=(select auth.uid()) and m.active));
create policy fleet_records_member_read on public.fleet_records for select to authenticated
  using (exists(select 1 from public.fleet_members m where m.company_id=fleet_records.company_id and m.user_id=(select auth.uid()) and m.active));

create function public.fleet_state_entities(p_state jsonb)
returns table(kind text,record_id text,data jsonb)
language sql immutable strict set search_path = '' as $$
  select 'farm'::text,item->>'id',item from jsonb_array_elements(p_state->'farms') item
  union all select 'truck'::text,item->>'id',item from jsonb_array_elements(p_state->'trucks') item
  union all select 'discount'::text,item->>'id',item from jsonb_array_elements(p_state->'discounts') item
  union all select 'closing'::text,item->>'id',item from jsonb_array_elements(p_state->'closings') item;
$$;
revoke all on function public.fleet_state_entities(jsonb) from public,anon,authenticated;
grant execute on function public.fleet_state_entities(jsonb) to service_role;

create function public.fleet_load_state(p_company uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'revision',c.revision,'company',jsonb_build_object('id',c.id,'name',c.name),
    'state',c.meta || jsonb_build_object(
      'farms',coalesce((select jsonb_agg(r.data order by r.record_id) from public.fleet_records r where r.company_id=c.id and r.kind='farm'),'[]'::jsonb),
      'trucks',coalesce((select jsonb_agg(r.data order by r.record_id) from public.fleet_records r where r.company_id=c.id and r.kind='truck'),'[]'::jsonb),
      'discounts',coalesce((select jsonb_agg(r.data order by r.record_id) from public.fleet_records r where r.company_id=c.id and r.kind='discount'),'[]'::jsonb),
      'closings',coalesce((select jsonb_agg(r.data order by r.record_id) from public.fleet_records r where r.company_id=c.id and r.kind='closing'),'[]'::jsonb)))
  from public.fleet_companies c where c.id=p_company;
$$;
revoke all on function public.fleet_load_state(uuid) from public,anon,authenticated;
grant execute on function public.fleet_load_state(uuid) to service_role;

create function public.fleet_commit_state(p_company uuid,p_actor uuid,p_expected bigint,p_state jsonb,p_action text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_revision bigint;
  actor_role text;
  diff jsonb;
begin
  select c.revision into current_revision from public.fleet_companies c where c.id=p_company for update;
  if not found then raise exception 'Empresa não encontrada' using errcode='P0002'; end if;
  select m.role into actor_role from public.fleet_members m where m.company_id=p_company and m.user_id=p_actor and m.active;
  if actor_role is null or actor_role not in ('admin','operator') then raise exception 'Sem permissão de alteração' using errcode='42501'; end if;
  if p_action in ('farms.save','farm.remove','farm.status','backup.import','examples.load','examples.remove') and actor_role <> 'admin' then raise exception 'Ação exige administrador' using errcode='42501'; end if;
  if current_revision <> p_expected then return jsonb_build_object('conflict',true,'revision',current_revision); end if;
  if jsonb_typeof(p_state->'farms') <> 'array' or jsonb_array_length(p_state->'farms')=0 or jsonb_typeof(p_state->'trucks') <> 'array' or jsonb_typeof(p_state->'discounts') <> 'array' or jsonb_typeof(p_state->'closings') <> 'array' then raise exception 'Registros inválidos' using errcode='22023'; end if;

  with old_rows as (select kind,record_id,data from public.fleet_records where company_id=p_company),
       new_rows as (select * from public.fleet_state_entities(p_state))
  select coalesce(jsonb_agg(jsonb_build_object('kind',coalesce(o.kind,n.kind),'id',coalesce(o.record_id,n.record_id),'before',o.data,'after',n.data)),'[]'::jsonb)
  into diff from old_rows o full join new_rows n using(kind,record_id) where o.data is distinct from n.data;

  delete from public.fleet_records r where r.company_id=p_company and not exists(select 1 from public.fleet_state_entities(p_state) n where n.kind=r.kind and n.record_id=r.record_id);
  insert into public.fleet_records(company_id,kind,record_id,data)
    select p_company,n.kind,n.record_id,n.data from public.fleet_state_entities(p_state) n
    on conflict(company_id,kind,record_id) do update set data=excluded.data,updated_at=now()
    where fleet_records.data is distinct from excluded.data;
  update public.fleet_companies set revision=current_revision+1,meta=p_state-'farms'-'trucks'-'discounts'-'closings',updated_at=now() where id=p_company;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes) values(p_company,p_actor,p_action,current_revision+1,diff);
  return public.fleet_load_state(p_company);
end;
$$;
revoke all on function public.fleet_commit_state(uuid,uuid,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.fleet_commit_state(uuid,uuid,bigint,jsonb,text) to service_role;
