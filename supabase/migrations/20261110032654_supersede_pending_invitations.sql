-- Issuing a new invitation for an address supersedes all earlier pending links.
-- Lock the company first, as acceptance and member changes do, so concurrent
-- issuance, acceptance, and administrative changes have one consistent order.
begin;

create function public.fleet_issue_invitation(
  p_company uuid, p_actor uuid, p_email text, p_role text, p_party text,
  p_farm_id text, p_farm_ids text[], p_hash text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  recipient text := lower(btrim(p_email));
  chosen_farms text[] := coalesce(p_farm_ids, '{}'::text[]);
  revoked_ids uuid[];
  issued public.fleet_invitations%rowtype;
begin
  perform 1 from public.fleet_companies where id=p_company for update;
  if not found then raise exception 'Empresa não encontrada' using errcode='22023'; end if;
  if not exists (
    select 1 from public.fleet_members
    where company_id=p_company and user_id=p_actor and role='admin' and party='group' and active
  ) then raise exception 'Ação exige administrador' using errcode='42501'; end if;
  if recipient is null or length(recipient) not between 3 and 320 or recipient !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'
    or p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'Convite inválido' using errcode='22023'; end if;
  if p_role not in ('admin','operator','viewer') or p_party not in ('group','carrier','farm')
    or (p_role='admin' and p_party<>'group')
    or (p_party='farm' and ((p_farm_id is null and cardinality(chosen_farms)<2)
      or (p_farm_id is not null and cardinality(chosen_farms)>0)))
    or (p_party<>'farm' and (p_farm_id is not null or cardinality(chosen_farms)>0))
  then raise exception 'Perfil de convite inválido' using errcode='22023'; end if;
  if exists (select 1 from unnest(chosen_farms) as f(id) where f.id is null or length(f.id) not between 1 and 200)
    or cardinality(chosen_farms) <> (select count(distinct id) from unnest(chosen_farms) as f(id))
    or (p_farm_id is not null and length(p_farm_id) not between 1 and 200)
  then raise exception 'Selecione fazendas válidas' using errcode='22023'; end if;
  if p_party='farm' and exists (
    select 1 from unnest(case when p_farm_id is null then chosen_farms else array[p_farm_id] end) as f(id)
    where not exists (
      select 1 from public.fleet_records r
      where r.company_id=p_company and r.kind='farm' and r.record_id=f.id
        and r.data->>'active' is distinct from 'false'
    )
  ) then raise exception 'Selecione somente fazendas ativas cadastradas' using errcode='22023'; end if;

  with revoked as (
    update public.fleet_invitations set revoked_at=clock_timestamp()
    where company_id=p_company and lower(email)=recipient
      and consumed_at is null and revoked_at is null
    returning id
  ) select coalesce(array_agg(id),'{}'::uuid[]) into revoked_ids from revoked;

  insert into public.fleet_invitations
    (company_id,email,role,party,farm_id,farm_ids,token_hash,expires_at)
  values
    (p_company,recipient,p_role,p_party,p_farm_id,chosen_farms,p_hash,clock_timestamp()+interval '72 hours')
  returning * into issued;

  insert into public.fleet_audit(company_id,actor_id,action,revision,changes)
    select p_company,p_actor,'team.invited',revision,
      jsonb_build_object('invitationId',issued.id,'email',recipient,'role',p_role,
        'party',p_party,'farmId',p_farm_id,'farmIds',chosen_farms,
        'revokedInvitationIds',to_jsonb(revoked_ids))
    from public.fleet_companies where id=p_company;

  return jsonb_build_object('id',issued.id,'expiresAt',issued.expires_at,
    'revokedInvitationIds',to_jsonb(revoked_ids));
end;
$$;

revoke all on function public.fleet_issue_invitation(uuid,uuid,text,text,text,text,text[],text)
  from public,anon,authenticated;
grant execute on function public.fleet_issue_invitation(uuid,uuid,text,text,text,text,text[],text)
  to service_role;

notify pgrst, 'reload schema';
commit;
