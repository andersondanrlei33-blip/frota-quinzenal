alter table public.fleet_members add column party text not null default 'group' check(party in ('group','carrier'));
alter table public.fleet_members add constraint fleet_members_admin_group check(role<>'admin' or party='group');
alter table public.fleet_invitations add column party text not null default 'group' check(party in ('group','carrier'));
alter table public.fleet_invitations add constraint fleet_invitations_admin_group check(role<>'admin' or party='group');
alter table public.fleet_records drop constraint fleet_records_kind_check;
alter table public.fleet_records add constraint fleet_records_kind_check check(kind in ('farm','truck','discount','closing','request'));
drop policy fleet_records_member_read on public.fleet_records;
create policy fleet_records_member_read on public.fleet_records for select to authenticated
using(exists(select 1 from public.fleet_members m where m.company_id=fleet_records.company_id and m.user_id=(select auth.uid()) and m.active and m.party='group'));
drop function public.fleet_change_member(uuid,uuid,uuid,text,boolean);
create or replace function public.fleet_state_entities(p_state jsonb)
returns table(kind text,record_id text,data jsonb)
language sql immutable strict set search_path = '' as $$
  select 'farm'::text,item->>'id',item from jsonb_array_elements(p_state->'farms') item
  union all select 'truck'::text,item->>'id',item from jsonb_array_elements(p_state->'trucks') item
  union all select 'discount'::text,item->>'id',item from jsonb_array_elements(p_state->'discounts') item
  union all select 'closing'::text,item->>'id',item from jsonb_array_elements(p_state->'closings') item
  union all select 'request'::text,item->>'id',item from jsonb_array_elements(coalesce(p_state->'paymentRequests','[]'::jsonb)) item;
$$;
revoke all on function public.fleet_state_entities(jsonb) from public,anon,authenticated;
grant execute on function public.fleet_state_entities(jsonb) to service_role;

create or replace function public.fleet_load_state(p_company uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'revision',c.revision,'company',jsonb_build_object('id',c.id,'name',c.name),
    'state',c.meta || jsonb_build_object(
      'farms',coalesce((select jsonb_agg(r.data order by r.record_id) from public.fleet_records r where r.company_id=c.id and r.kind='farm'),'[]'::jsonb),
      'trucks',coalesce((select jsonb_agg(r.data order by r.record_id) from public.fleet_records r where r.company_id=c.id and r.kind='truck'),'[]'::jsonb),
      'discounts',coalesce((select jsonb_agg(r.data order by r.record_id) from public.fleet_records r where r.company_id=c.id and r.kind='discount'),'[]'::jsonb),
      'closings',coalesce((select jsonb_agg(r.data order by r.record_id) from public.fleet_records r where r.company_id=c.id and r.kind='closing'),'[]'::jsonb),
      'paymentRequests',coalesce((select jsonb_agg(r.data order by r.record_id) from public.fleet_records r where r.company_id=c.id and r.kind='request'),'[]'::jsonb)))
  from public.fleet_companies c where c.id=p_company;
$$;
revoke all on function public.fleet_load_state(uuid) from public,anon,authenticated;
grant execute on function public.fleet_load_state(uuid) to service_role;

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
  if p_action='payment.record' and actor_party<>'carrier' then raise exception 'O pagamento exige acesso da transportadora' using errcode='42501'; end if;
  if p_action='payment.undo' and actor_party<>'carrier' and actor_role<>'admin' then raise exception 'Correção exige acesso da transportadora' using errcode='42501'; end if;
  if p_action not in ('payment.record','payment.undo') and actor_party<>'group' then raise exception 'Ação exige acesso do grupo' using errcode='42501'; end if;
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
  update public.fleet_companies set revision=current_revision+1,meta=p_state-'farms'-'trucks'-'discounts'-'closings'-'paymentRequests',updated_at=now() where id=p_company;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes) values(p_company,p_actor,p_action,current_revision+1,diff);
  return public.fleet_load_state(p_company);
end;
$$;
revoke all on function public.fleet_commit_state(uuid,uuid,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.fleet_commit_state(uuid,uuid,bigint,jsonb,text) to service_role;

create or replace function public.fleet_inspect_invitation(p_hash text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('companyId',i.company_id,'companyName',c.name,'email',i.email,'role',i.role,'party',i.party,'firstAccess',i.email='')
  from public.fleet_invitations i join public.fleet_companies c on c.id=i.company_id
  where i.token_hash=p_hash and i.consumed_at is null and i.expires_at>now();
$$;
revoke all on function public.fleet_inspect_invitation(text) from public,anon,authenticated;
grant execute on function public.fleet_inspect_invitation(text) to service_role;

create or replace function public.fleet_accept_invitation(p_hash text,p_user uuid,p_email text,p_company_name text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare invitation public.fleet_invitations%rowtype;
begin
  select * into invitation from public.fleet_invitations where token_hash=p_hash and consumed_at is null and expires_at>now() for update;
  if not found then raise exception 'Link inválido, utilizado ou expirado' using errcode='22023'; end if;
  perform 1 from public.fleet_companies where id=invitation.company_id for update;
  if invitation.email='' then
    if invitation.role<>'admin' or exists(select 1 from public.fleet_members where company_id=invitation.company_id) then raise exception 'Primeiro acesso já configurado' using errcode='42501'; end if;
    if p_company_name is null or length(btrim(p_company_name)) not between 1 and 120 then raise exception 'Informe o nome da empresa' using errcode='22023'; end if;
    update public.fleet_companies set name=btrim(p_company_name),updated_at=now() where id=invitation.company_id;
  elsif lower(invitation.email)<>lower(p_email) then raise exception 'Use o e-mail do convite' using errcode='42501';
  end if;
  if exists(select 1 from public.fleet_members where company_id=invitation.company_id and user_id=p_user and role='admin' and active) and invitation.role<>'admin' and not exists(select 1 from public.fleet_members where company_id=invitation.company_id and user_id<>p_user and role='admin' and active) then raise exception 'Mantenha pelo menos um administrador ativo' using errcode='42501'; end if;
  insert into public.fleet_members(company_id,user_id,email,role,party,active) values(invitation.company_id,p_user,lower(p_email),invitation.role,invitation.party,true)
  on conflict(company_id,user_id) do update set email=excluded.email,role=excluded.role,party=excluded.party,active=true;
  update public.fleet_invitations set consumed_at=now() where id=invitation.id;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes)
    select invitation.company_id,p_user,'team.joined',revision,jsonb_build_object('userId',p_user,'role',invitation.role,'party',invitation.party) from public.fleet_companies where id=invitation.company_id;
  return jsonb_build_object('companyId',invitation.company_id,'role',invitation.role,'party',invitation.party);
end;
$$;
revoke all on function public.fleet_accept_invitation(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fleet_accept_invitation(text,uuid,text,text) to service_role;

create or replace function public.fleet_change_member(p_company uuid,p_actor uuid,p_target uuid,p_role text,p_active boolean,p_party text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare member public.fleet_members%rowtype; chosen_party text;
begin
  perform 1 from public.fleet_companies where id=p_company for update;
  if not exists(select 1 from public.fleet_members where company_id=p_company and user_id=p_actor and role='admin' and active) then raise exception 'Ação exige administrador' using errcode='42501'; end if;
  if p_role not in ('admin','operator','viewer') then raise exception 'Perfil inválido' using errcode='22023'; end if;
  select * into member from public.fleet_members where company_id=p_company and user_id=p_target for update;
  if not found then raise exception 'Usuário não encontrado' using errcode='22023'; end if;
  chosen_party=coalesce(p_party,member.party);
  if chosen_party not in ('group','carrier') or (p_role='admin' and chosen_party<>'group') then raise exception 'Perfil de acesso inválido' using errcode='22023'; end if;
  if member.role='admin' and member.active and (not p_active or p_role<>'admin') and not exists(select 1 from public.fleet_members where company_id=p_company and user_id<>p_target and role='admin' and active) then raise exception 'Mantenha pelo menos um administrador ativo' using errcode='42501'; end if;
  update public.fleet_members set role=p_role,party=chosen_party,active=p_active where company_id=p_company and user_id=p_target;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes)
    select p_company,p_actor,'team.updated',revision,jsonb_build_object('userId',p_target,'before',jsonb_build_object('role',member.role,'party',member.party,'active',member.active),'after',jsonb_build_object('role',p_role,'party',chosen_party,'active',p_active)) from public.fleet_companies where id=p_company;
  return jsonb_build_object('success',true);
end;
$$;
revoke all on function public.fleet_change_member(uuid,uuid,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.fleet_change_member(uuid,uuid,uuid,text,boolean,text) to service_role;

create table public.fleet_receipts(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.fleet_companies(id),
 request_kind text not null default 'request' check(request_kind='request'),
 request_id text not null,
 uploaded_by uuid not null references auth.users(id),
 object_key text not null unique,
 file_name text not null check(length(file_name) between 1 and 160),
 content_type text not null check(content_type in ('application/pdf','image/png','image/jpeg')),
 size_bytes integer not null check(size_bytes between 1 and 10485760),
 created_at timestamptz not null default now(),
 foreign key(company_id,request_kind,request_id) references public.fleet_records(company_id,kind,record_id),
 check(object_key like company_id::text || '/%')
);
create index fleet_receipts_request_idx on public.fleet_receipts(company_id,request_kind,request_id);
create index fleet_receipts_user_idx on public.fleet_receipts(uploaded_by);
alter table public.fleet_receipts enable row level security;
revoke all on public.fleet_receipts from anon,authenticated;
grant all on public.fleet_receipts to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fleet-receipts','fleet-receipts',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
