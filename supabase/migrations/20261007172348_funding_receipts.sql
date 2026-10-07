create table public.fleet_funding_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.fleet_companies(id),
  transfer_id text not null,
  uploaded_by uuid not null references auth.users(id),
  object_key text not null unique,
  file_name text not null check(length(file_name) between 1 and 160),
  content_type text not null check(content_type in ('application/pdf','image/png','image/jpeg')),
  size_bytes integer not null check(size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  check(object_key like company_id::text || '/funding/%')
);
create index fleet_funding_receipts_transfer_idx on public.fleet_funding_receipts(company_id,transfer_id);
alter table public.fleet_funding_receipts enable row level security;
revoke all on public.fleet_funding_receipts from anon,authenticated;
grant all on public.fleet_funding_receipts to service_role;

create or replace function public.fleet_commit_state(p_company uuid,p_actor uuid,p_expected bigint,p_state jsonb,p_action text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_revision bigint;
  actor_role text;
  actor_party text;
  diff jsonb;
begin
  select c.revision into current_revision from public.fleet_companies c where c.id=p_company for update;
  if not found then raise exception 'Empresa não encontrada' using errcode='P0002'; end if;
  select m.role,m.party into actor_role,actor_party from public.fleet_members m where m.company_id=p_company and m.user_id=p_actor and m.active;
  if actor_role is null or actor_role not in ('admin','operator') then raise exception 'Sem permissão de alteração' using errcode='42501'; end if;
  if p_action in ('farms.save','farm.remove','farm.status','backup.import','examples.load','examples.remove') and actor_role <> 'admin' then raise exception 'Ação exige administrador' using errcode='42501'; end if;
  if p_action in ('payment.record','funding.receipt') and actor_party<>'carrier' then raise exception 'Esta ação exige acesso da transportadora' using errcode='42501'; end if;
  if p_action='payment.undo' and actor_party<>'carrier' and actor_role<>'admin' then raise exception 'Correção exige acesso da transportadora' using errcode='42501'; end if;
  if p_action not in ('payment.record','payment.undo','funding.receipt') and actor_party<>'group' then raise exception 'Ação exige acesso do grupo' using errcode='42501'; end if;
  if current_revision <> p_expected then return jsonb_build_object('conflict',true,'revision',current_revision); end if;
  if jsonb_typeof(p_state->'farms') <> 'array' or jsonb_array_length(p_state->'farms')=0 or jsonb_typeof(p_state->'trucks') <> 'array' or jsonb_typeof(p_state->'discounts') <> 'array' or jsonb_typeof(p_state->'closings') <> 'array' or jsonb_typeof(p_state->'fundingTransfers') <> 'array' then raise exception 'Registros inválidos' using errcode='22023'; end if;

  with old_rows as (select kind,record_id,data from public.fleet_records where company_id=p_company),
       new_rows as (select * from public.fleet_state_entities(p_state))
  select coalesce(jsonb_agg(jsonb_build_object('kind',coalesce(o.kind,n.kind),'id',coalesce(o.record_id,n.record_id),'before',o.data,'after',n.data)),'[]'::jsonb)
  into diff from old_rows o full join new_rows n using(kind,record_id) where o.data is distinct from n.data;

  delete from public.fleet_records r where r.company_id=p_company and not exists(select 1 from public.fleet_state_entities(p_state) n where n.kind=r.kind and n.record_id=r.record_id);
  insert into public.fleet_records(company_id,kind,record_id,data)
    select p_company,n.kind,n.record_id,n.data from public.fleet_state_entities(p_state) n
    on conflict(company_id,kind,record_id) do update set data=excluded.data,updated_at=now()
    where fleet_records.data is distinct from excluded.data;
  update public.fleet_companies set revision=current_revision+1,meta=p_state-'farms'-'trucks'-'discounts'-'closings'-'paymentRequests',updated_at=now() where id=p_company;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes) values(p_company,p_actor,p_action,current_revision+1,diff);
  return public.fleet_load_state(p_company);
end;
$$;
revoke all on function public.fleet_commit_state(uuid,uuid,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.fleet_commit_state(uuid,uuid,bigint,jsonb,text) to service_role;
