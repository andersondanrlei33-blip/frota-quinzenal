alter table public.fleet_members drop constraint fleet_members_party_check;
alter table public.fleet_members add constraint fleet_members_party_check check(party in ('group','carrier','farm'));
alter table public.fleet_members add column farm_id text;
alter table public.fleet_invitations drop constraint fleet_invitations_party_check;
alter table public.fleet_invitations add constraint fleet_invitations_party_check check(party in ('group','carrier','farm'));
alter table public.fleet_invitations add column farm_id text;
alter table public.fleet_members add constraint fleet_members_farm_scope check((party='farm' and farm_id is not null and length(farm_id) between 1 and 200) or (party<>'farm' and farm_id is null));
alter table public.fleet_invitations add constraint fleet_invitations_farm_scope check((party='farm' and farm_id is not null and length(farm_id) between 1 and 200) or (party<>'farm' and farm_id is null));
alter table public.fleet_members drop constraint fleet_members_admin_group;
alter table public.fleet_members add constraint fleet_members_admin_group check(role<>'admin' or party='group');
alter table public.fleet_invitations drop constraint fleet_invitations_admin_group;
alter table public.fleet_invitations add constraint fleet_invitations_admin_group check(role<>'admin' or party='group');

create table public.fleet_cte_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.fleet_companies(id) on delete cascade,
  farm_id text not null,
  farm_name text not null check(length(btrim(farm_name)) between 1 and 80),
  truck_id text not null,
  plate text not null check(length(plate) between 7 and 8),
  driver text not null check(length(btrim(driver)) between 1 and 100),
  invoice_keys jsonb not null check(jsonb_typeof(invoice_keys)='array' and jsonb_array_length(invoice_keys) between 1 and 100),
  note text not null default '' check(length(note)<=500),
  status text not null default 'pending' check(status in ('pending','issued')),
  requested_by uuid not null references auth.users(id),
  requested_email text not null default '',
  cte_document_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(cte_document_id is null or status='issued')
);
create index fleet_cte_requests_company_idx on public.fleet_cte_requests(company_id,status,created_at desc);
create index fleet_cte_requests_farm_idx on public.fleet_cte_requests(company_id,farm_id,created_at desc);
alter table public.fleet_cte_requests enable row level security;
revoke all on public.fleet_cte_requests from anon,authenticated;
grant all on public.fleet_cte_requests to service_role;

alter table public.fleet_cte_documents add column request_id uuid references public.fleet_cte_requests(id) on delete set null;
alter table public.fleet_cte_requests add constraint fleet_cte_requests_document_fk foreign key(cte_document_id) references public.fleet_cte_documents(id) on delete set null;
create unique index fleet_cte_documents_request_idx on public.fleet_cte_documents(request_id) where request_id is not null;

create or replace function public.fleet_inspect_invitation(p_hash text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('companyId',i.company_id,'companyName',c.name,'email',i.email,'role',i.role,'party',i.party,'farmId',i.farm_id,'farmName',(select r.data->>'name' from public.fleet_records r where r.company_id=i.company_id and r.kind='farm' and r.record_id=i.farm_id),'firstAccess',i.email='')
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
  elsif lower(invitation.email)<>lower(p_email) then raise exception 'Use o e-mail do convite' using errcode='42501'; end if;
  if invitation.party='farm' and not exists(select 1 from public.fleet_records where company_id=invitation.company_id and kind='farm' and record_id=invitation.farm_id) then raise exception 'A fazenda do convite não existe mais' using errcode='22023'; end if;
  if exists(select 1 from public.fleet_members where company_id=invitation.company_id and user_id=p_user and role='admin' and active) and invitation.role<>'admin' and not exists(select 1 from public.fleet_members where company_id=invitation.company_id and user_id<>p_user and role='admin' and active) then raise exception 'Mantenha pelo menos um administrador ativo' using errcode='42501'; end if;
  insert into public.fleet_members(company_id,user_id,email,role,party,farm_id,active) values(invitation.company_id,p_user,lower(p_email),invitation.role,invitation.party,invitation.farm_id,true)
  on conflict(company_id,user_id) do update set email=excluded.email,role=excluded.role,party=excluded.party,farm_id=excluded.farm_id,active=true;
  update public.fleet_invitations set consumed_at=now() where id=invitation.id;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes)
    select invitation.company_id,p_user,'team.joined',revision,jsonb_build_object('userId',p_user,'role',invitation.role,'party',invitation.party,'farmId',invitation.farm_id) from public.fleet_companies where id=invitation.company_id;
  return jsonb_build_object('companyId',invitation.company_id,'role',invitation.role,'party',invitation.party,'farmId',invitation.farm_id);
end;
$$;
revoke all on function public.fleet_accept_invitation(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fleet_accept_invitation(text,uuid,text,text) to service_role;

drop function public.fleet_change_member(uuid,uuid,uuid,text,boolean,text);
create function public.fleet_change_member(p_company uuid,p_actor uuid,p_target uuid,p_role text,p_active boolean,p_party text default null,p_farm_id text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare member public.fleet_members%rowtype; chosen_party text; chosen_farm text;
begin
  perform 1 from public.fleet_companies where id=p_company for update;
  if not exists(select 1 from public.fleet_members where company_id=p_company and user_id=p_actor and role='admin' and active and party='group') then raise exception 'Ação exige administrador' using errcode='42501'; end if;
  if p_role not in ('admin','operator','viewer') then raise exception 'Perfil inválido' using errcode='22023'; end if;
  select * into member from public.fleet_members where company_id=p_company and user_id=p_target for update;
  if not found then raise exception 'Usuário não encontrado' using errcode='22023'; end if;
  chosen_party=coalesce(p_party,member.party);chosen_farm=case when chosen_party='farm' then coalesce(p_farm_id,member.farm_id) else null end;
  if chosen_party not in ('group','carrier','farm') or (p_role='admin' and chosen_party<>'group') then raise exception 'Perfil de acesso inválido' using errcode='22023'; end if;
  if chosen_party='farm' and not exists(select 1 from public.fleet_records where company_id=p_company and kind='farm' and record_id=chosen_farm) then raise exception 'Selecione uma fazenda válida' using errcode='22023'; end if;
  if member.role='admin' and member.active and (not p_active or p_role<>'admin') and not exists(select 1 from public.fleet_members where company_id=p_company and user_id<>p_target and role='admin' and active) then raise exception 'Mantenha pelo menos um administrador ativo' using errcode='42501'; end if;
  update public.fleet_members set role=p_role,party=chosen_party,farm_id=chosen_farm,active=p_active where company_id=p_company and user_id=p_target;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes)
    select p_company,p_actor,'team.updated',revision,jsonb_build_object('userId',p_target,'before',jsonb_build_object('role',member.role,'party',member.party,'farmId',member.farm_id,'active',member.active),'after',jsonb_build_object('role',p_role,'party',chosen_party,'farmId',chosen_farm,'active',p_active)) from public.fleet_companies where id=p_company;
  return jsonb_build_object('success',true);
end;
$$;
revoke all on function public.fleet_change_member(uuid,uuid,uuid,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.fleet_change_member(uuid,uuid,uuid,text,boolean,text,text) to service_role;
