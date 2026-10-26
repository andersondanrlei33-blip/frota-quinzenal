alter table public.fleet_members add column farm_ids text[] not null default '{}';
alter table public.fleet_invitations add column farm_ids text[] not null default '{}';

alter table public.fleet_members drop constraint fleet_members_farm_scope;
alter table public.fleet_members add constraint fleet_members_farm_scope check (
  (party='farm' and (
    (farm_id is not null and length(farm_id) between 1 and 200 and cardinality(farm_ids)=0)
    or (farm_id is null and cardinality(farm_ids)>=2)
  )) or (party<>'farm' and farm_id is null and cardinality(farm_ids)=0)
);
alter table public.fleet_invitations drop constraint fleet_invitations_farm_scope;
alter table public.fleet_invitations add constraint fleet_invitations_farm_scope check (
  (party='farm' and (
    (farm_id is not null and length(farm_id) between 1 and 200 and cardinality(farm_ids)=0)
    or (farm_id is null and cardinality(farm_ids)>=2)
  )) or (party<>'farm' and farm_id is null and cardinality(farm_ids)=0)
);

create or replace function public.fleet_inspect_invitation(p_hash text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'companyId',i.company_id,'companyName',c.name,'email',i.email,'role',i.role,'party',i.party,
    'farmId',i.farm_id,'farmIds',to_jsonb(case when cardinality(i.farm_ids)>0 then i.farm_ids when i.farm_id is not null then array[i.farm_id] else '{}'::text[] end),
    'farmName',(select r.data->>'name' from public.fleet_records r where r.company_id=i.company_id and r.kind='farm' and r.record_id=i.farm_id),
    'farmNames',(select coalesce(jsonb_agg(r.data->>'name' order by r.data->>'name'),'[]'::jsonb) from public.fleet_records r where r.company_id=i.company_id and r.kind='farm' and r.record_id=any(i.farm_ids)),
    'firstAccess',i.email=''
  )
  from public.fleet_invitations i join public.fleet_companies c on c.id=i.company_id
  where i.token_hash=p_hash and i.consumed_at is null and i.expires_at>now();
$$;
revoke all on function public.fleet_inspect_invitation(text) from public,anon,authenticated;
grant execute on function public.fleet_inspect_invitation(text) to service_role;

create or replace function public.fleet_accept_invitation(p_hash text,p_user uuid,p_email text,p_company_name text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare invitation public.fleet_invitations%rowtype; chosen_farms text[];
begin
  select * into invitation from public.fleet_invitations where token_hash=p_hash and consumed_at is null and expires_at>now() for update;
  if not found then raise exception 'Link inválido, utilizado ou expirado' using errcode='22023'; end if;
  perform 1 from public.fleet_companies where id=invitation.company_id for update;
  if invitation.email='' then
    if invitation.role<>'admin' or exists(select 1 from public.fleet_members where company_id=invitation.company_id) then raise exception 'Primeiro acesso já configurado' using errcode='42501'; end if;
    if p_company_name is null or length(btrim(p_company_name)) not between 1 and 120 then raise exception 'Informe o nome da empresa' using errcode='22023'; end if;
    update public.fleet_companies set name=btrim(p_company_name),updated_at=now() where id=invitation.company_id;
  elsif lower(invitation.email)<>lower(p_email) then raise exception 'Use o e-mail do convite' using errcode='42501'; end if;
  chosen_farms:=case when cardinality(invitation.farm_ids)>0 then invitation.farm_ids when invitation.farm_id is not null then array[invitation.farm_id] else '{}'::text[] end;
  if invitation.party='farm' and exists(select 1 from unnest(chosen_farms) f(id) where not exists(select 1 from public.fleet_records r where r.company_id=invitation.company_id and r.kind='farm' and r.record_id=f.id)) then raise exception 'Uma das fazendas do convite não existe mais' using errcode='22023'; end if;
  if exists(select 1 from public.fleet_members where company_id=invitation.company_id and user_id=p_user and role='admin' and active) and invitation.role<>'admin' and not exists(select 1 from public.fleet_members where company_id=invitation.company_id and user_id<>p_user and role='admin' and active) then raise exception 'Mantenha pelo menos um administrador ativo' using errcode='42501'; end if;
  insert into public.fleet_members(company_id,user_id,email,role,party,farm_id,farm_ids,active)
  values(invitation.company_id,p_user,lower(p_email),invitation.role,invitation.party,invitation.farm_id,case when invitation.party='farm' and invitation.farm_id is null then chosen_farms else '{}'::text[] end,true)
  on conflict(company_id,user_id) do update set email=excluded.email,role=excluded.role,party=excluded.party,farm_id=excluded.farm_id,farm_ids=excluded.farm_ids,active=true;
  update public.fleet_invitations set consumed_at=now() where id=invitation.id;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes)
    select invitation.company_id,p_user,'team.joined',revision,jsonb_build_object('userId',p_user,'role',invitation.role,'party',invitation.party,'farmId',invitation.farm_id,'farmIds',chosen_farms) from public.fleet_companies where id=invitation.company_id;
  return jsonb_build_object('companyId',invitation.company_id,'role',invitation.role,'party',invitation.party,'farmId',invitation.farm_id,'farmIds',chosen_farms);
end;
$$;
revoke all on function public.fleet_accept_invitation(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fleet_accept_invitation(text,uuid,text,text) to service_role;

drop function public.fleet_change_member(uuid,uuid,uuid,text,boolean,text,text);
create function public.fleet_change_member(p_company uuid,p_actor uuid,p_target uuid,p_role text,p_active boolean,p_party text default null,p_farm_id text default null,p_farm_ids text[] default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare member public.fleet_members%rowtype; chosen_party text; chosen_farm text; chosen_farms text[];
begin
  perform 1 from public.fleet_companies where id=p_company for update;
  if not exists(select 1 from public.fleet_members where company_id=p_company and user_id=p_actor and role='admin' and active and party='group') then raise exception 'Ação exige administrador' using errcode='42501'; end if;
  if p_role not in ('admin','operator','viewer') then raise exception 'Perfil inválido' using errcode='22023'; end if;
  select * into member from public.fleet_members where company_id=p_company and user_id=p_target for update;
  if not found then raise exception 'Usuário não encontrado' using errcode='22023'; end if;
  chosen_party:=coalesce(p_party,member.party);
  chosen_farm:=case when chosen_party<>'farm' or (p_farm_ids is not null and cardinality(p_farm_ids)>0) then null else coalesce(p_farm_id,member.farm_id) end;
  chosen_farms:=case when chosen_party<>'farm' then '{}'::text[] when p_party is null and p_farm_ids is null then member.farm_ids when p_farm_ids is not null then p_farm_ids else '{}'::text[] end;
  if chosen_party not in ('group','carrier','farm') or (p_role='admin' and chosen_party<>'group') then raise exception 'Perfil de acesso inválido' using errcode='22023'; end if;
  if chosen_party='farm' and ((chosen_farm is null and cardinality(chosen_farms)<2) or (chosen_farm is not null and cardinality(chosen_farms)>0)) then raise exception 'Selecione uma fazenda ou pelo menos duas fazendas' using errcode='22023'; end if;
  if cardinality(chosen_farms)>0 and cardinality(chosen_farms)<>cardinality(array(select distinct unnest(chosen_farms))) then raise exception 'Não repita fazendas no mesmo acesso' using errcode='22023'; end if;
  if chosen_party='farm' and exists(select 1 from unnest(case when chosen_farm is not null then array[chosen_farm] else chosen_farms end) f(id) where not exists(select 1 from public.fleet_records r where r.company_id=p_company and r.kind='farm' and r.record_id=f.id)) then raise exception 'Selecione fazendas válidas' using errcode='22023'; end if;
  if member.role='admin' and member.active and (not p_active or p_role<>'admin') and not exists(select 1 from public.fleet_members where company_id=p_company and user_id<>p_target and role='admin' and active) then raise exception 'Mantenha pelo menos um administrador ativo' using errcode='42501'; end if;
  update public.fleet_members set role=p_role,party=chosen_party,farm_id=chosen_farm,farm_ids=chosen_farms,active=p_active where company_id=p_company and user_id=p_target;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes)
    select p_company,p_actor,'team.updated',revision,jsonb_build_object('userId',p_target,'before',jsonb_build_object('role',member.role,'party',member.party,'farmId',member.farm_id,'farmIds',member.farm_ids,'active',member.active),'after',jsonb_build_object('role',p_role,'party',chosen_party,'farmId',chosen_farm,'farmIds',chosen_farms,'active',p_active)) from public.fleet_companies where id=p_company;
  return jsonb_build_object('success',true,'farmId',chosen_farm,'farmIds',chosen_farms);
end;
$$;
revoke all on function public.fleet_change_member(uuid,uuid,uuid,text,boolean,text,text,text[]) from public,anon,authenticated;
grant execute on function public.fleet_change_member(uuid,uuid,uuid,text,boolean,text,text,text[]) to service_role;

notify pgrst, 'reload schema';
