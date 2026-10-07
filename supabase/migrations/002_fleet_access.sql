create index fleet_audit_actor_idx on public.fleet_audit(actor_id);

create function public.fleet_inspect_invitation(p_hash text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('companyId',i.company_id,'companyName',c.name,'email',i.email,'role',i.role,'firstAccess',i.email='')
  from public.fleet_invitations i join public.fleet_companies c on c.id=i.company_id
  where i.token_hash=p_hash and i.consumed_at is null and i.expires_at>now();
$$;
revoke all on function public.fleet_inspect_invitation(text) from public,anon,authenticated;
grant execute on function public.fleet_inspect_invitation(text) to service_role;

create function public.fleet_accept_invitation(p_hash text,p_user uuid,p_email text,p_company_name text default null)
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
  insert into public.fleet_members(company_id,user_id,email,role,active) values(invitation.company_id,p_user,lower(p_email),invitation.role,true)
  on conflict(company_id,user_id) do update set email=excluded.email,role=excluded.role,active=true;
  update public.fleet_invitations set consumed_at=now() where id=invitation.id;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes)
    select invitation.company_id,p_user,'team.joined',revision,jsonb_build_object('userId',p_user,'role',invitation.role) from public.fleet_companies where id=invitation.company_id;
  return jsonb_build_object('companyId',invitation.company_id,'role',invitation.role);
end;
$$;
revoke all on function public.fleet_accept_invitation(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fleet_accept_invitation(text,uuid,text,text) to service_role;

create function public.fleet_change_member(p_company uuid,p_actor uuid,p_target uuid,p_role text,p_active boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare member public.fleet_members%rowtype;
begin
  perform 1 from public.fleet_companies where id=p_company for update;
  if not exists(select 1 from public.fleet_members where company_id=p_company and user_id=p_actor and role='admin' and active) then raise exception 'Ação exige administrador' using errcode='42501'; end if;
  if p_role not in ('admin','operator','viewer') then raise exception 'Perfil inválido' using errcode='22023'; end if;
  select * into member from public.fleet_members where company_id=p_company and user_id=p_target for update;
  if not found then raise exception 'Usuário não encontrado' using errcode='22023'; end if;
  if member.role='admin' and member.active and (not p_active or p_role<>'admin') and not exists(select 1 from public.fleet_members where company_id=p_company and user_id<>p_target and role='admin' and active) then raise exception 'Mantenha pelo menos um administrador ativo' using errcode='42501'; end if;
  update public.fleet_members set role=p_role,active=p_active where company_id=p_company and user_id=p_target;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes)
    select p_company,p_actor,'team.updated',revision,jsonb_build_object('userId',p_target,'before',jsonb_build_object('role',member.role,'active',member.active),'after',jsonb_build_object('role',p_role,'active',p_active)) from public.fleet_companies where id=p_company;
  return jsonb_build_object('success',true);
end;
$$;
revoke all on function public.fleet_change_member(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.fleet_change_member(uuid,uuid,uuid,text,boolean) to service_role;
