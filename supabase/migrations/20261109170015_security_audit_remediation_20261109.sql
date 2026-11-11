-- Security remediation migration generated with Supabase CLI v3.1.0.
-- User policy confirmed 2026-11-09: administrative access changes invalidate earlier pending invitations.
-- Existing invitations, expiry dates, payments and invoice snapshots remain intact.
begin;
alter table public.fleet_invitations add column revoked_at timestamptz;
-- New uploads are identified by their server-computed bytes, even when nCT is unavailable.
-- Leave legacy files/rows intact; no historical digest is guessed or backfilled.
alter table public.fleet_cte_documents add column content_sha256 text
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');
create unique index fleet_cte_documents_company_content_sha256_uidx on public.fleet_cte_documents(company_id, content_sha256) where content_sha256 is not null;
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
  where i.token_hash=p_hash and i.consumed_at is null and i.revoked_at is null and i.expires_at>now();
$$;
revoke all on function public.fleet_inspect_invitation(text) from public,anon,authenticated;
grant execute on function public.fleet_inspect_invitation(text) to service_role;

create or replace function public.fleet_accept_invitation(p_hash text,p_user uuid,p_email text,p_company_name text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare invitation public.fleet_invitations%rowtype; chosen_farms text[]; target_company uuid;
begin
  -- Serialize acceptance and administrative changes in the same order: company, then invitation.
  select company_id into target_company from public.fleet_invitations where token_hash=p_hash;
  if not found then raise exception 'Link inválido, utilizado ou expirado' using errcode='22023'; end if;
  perform 1 from public.fleet_companies where id=target_company for update;
  select * into invitation from public.fleet_invitations
    where token_hash=p_hash and company_id=target_company and consumed_at is null
      and revoked_at is null and expires_at>clock_timestamp() for update;
  if not found then raise exception 'Link inválido, utilizado, revogado ou expirado' using errcode='22023'; end if;
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

create or replace function public.fleet_change_member(p_company uuid,p_actor uuid,p_target uuid,p_role text,p_active boolean,p_party text default null,p_farm_id text default null,p_farm_ids text[] default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare member public.fleet_members%rowtype; chosen_party text; chosen_farm text; chosen_farms text[]; revoked_invites uuid[];
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
  -- Keep every invitation row, its original expiry, and its consumption history.
  with revoked as (
    update public.fleet_invitations set revoked_at=clock_timestamp()
      where company_id=p_company and lower(email)=lower(member.email)
        and consumed_at is null and revoked_at is null
      returning id
  ) select coalesce(array_agg(id),'{}'::uuid[]) into revoked_invites from revoked;
  insert into public.fleet_audit(company_id,actor_id,action,revision,changes)
    select p_company,p_actor,'team.updated',revision,jsonb_build_object('revokedInvitationIds',to_jsonb(revoked_invites),'userId',p_target,'before',jsonb_build_object('role',member.role,'party',member.party,'farmId',member.farm_id,'farmIds',member.farm_ids,'active',member.active),'after',jsonb_build_object('role',p_role,'party',chosen_party,'farmId',chosen_farm,'farmIds',chosen_farms,'active',p_active)) from public.fleet_companies where id=p_company;
  return jsonb_build_object('success',true,'farmId',chosen_farm,'farmIds',chosen_farms);
end;
$$;
revoke all on function public.fleet_change_member(uuid,uuid,uuid,text,boolean,text,text,text[]) from public,anon,authenticated;
grant execute on function public.fleet_change_member(uuid,uuid,uuid,text,boolean,text,text,text[]) to service_role;

notify pgrst, 'reload schema';

create or replace function public.fleet_issue_cte_billing_invoice(
  p_company uuid,
  p_actor uuid,
  p_document_ids uuid[],
  p_due_on date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  selected_count integer;
  eligible_count integer;
  month_count integer;
  farm_count integer;
  missing_farm_count integer;
  invoice_month date;
  tons numeric(16,3);
  amount numeric(16,2);
  invoice_row public.fleet_cte_billing_invoices%rowtype;
begin
  if p_document_ids is null or cardinality(p_document_ids) < 1 or cardinality(p_document_ids) > 500
    or (select count(distinct value) from unnest(p_document_ids) as ids(value)) <> cardinality(p_document_ids)
  then raise exception 'Seleção de CT-es inválida.' using errcode = '22023'; end if;
  if p_due_on is null or p_due_on < (now() at time zone 'America/Cuiaba')::date then
    raise exception 'Vencimento inválido.' using errcode = '22023';
  end if;

  perform 1 from public.fleet_cte_documents d
   where d.company_id = p_company and d.id = any(p_document_ids)
   order by d.id for update;

  select count(*),
         count(*) filter (where d.cargo_weight is not null and d.billable_tons is not null and d.billing_amount is not null and d.payment_receipt is null),
         count(distinct date_trunc('month', d.issued_on)),
         count(distinct d.farm_id),
         count(*) filter (where d.farm_id is null),
         min(date_trunc('month', d.issued_on)::date),
         coalesce(sum(d.billable_tons), 0),
         coalesce(sum(d.billing_amount), 0)
    into selected_count, eligible_count, month_count, farm_count, missing_farm_count, invoice_month, tons, amount
    from public.fleet_cte_documents d
   where d.company_id = p_company and d.id = any(p_document_ids);
  if selected_count <> cardinality(p_document_ids) then raise exception 'Um ou mais CT-es não pertencem à empresa.' using errcode = 'P0001'; end if;
  if eligible_count <> selected_count then raise exception 'Um ou mais CT-es já foram pagos ou estão sem peso identificado.' using errcode = 'P0001'; end if;
  if month_count <> 1 then raise exception 'Selecione CT-es de uma única competência mensal.' using errcode = 'P0001'; end if;
  if farm_count <> 1 or missing_farm_count > 0 then
    raise exception 'Cada fatura deve conter CT-es de uma única fazenda.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.fleet_cte_billing_invoice_items i where i.document_id = any(p_document_ids)) then
    raise exception 'Um ou mais CT-es já pertencem a uma fatura.' using errcode = 'P0001';
  end if;

  insert into public.fleet_cte_billing_invoices(company_id, billing_month, due_on, total_tons, total_amount, issued_by)
  values (p_company, invoice_month, p_due_on, tons, amount, p_actor)
  returning * into invoice_row;
  insert into public.fleet_cte_billing_invoice_items(invoice_id, document_id)
  select invoice_row.id, selected.id from public.fleet_cte_documents selected
   where selected.company_id = p_company and selected.id = any(p_document_ids);

  return jsonb_build_object('id', invoice_row.id, 'number', invoice_row.invoice_number::text,
    'companyId', invoice_row.company_id, 'billingMonth', to_char(invoice_row.billing_month, 'YYYY-MM'),
    'dueOn', invoice_row.due_on, 'totalTons', invoice_row.total_tons,
    'totalAmount', invoice_row.total_amount, 'status', invoice_row.status, 'issuedAt', invoice_row.issued_at,
    'paymentReceipt', null, 'documentIds', to_jsonb(p_document_ids));
end;
$function$;

revoke all on function public.fleet_issue_cte_billing_invoice(uuid,uuid,uuid[],date) from public,anon,authenticated;
grant execute on function public.fleet_issue_cte_billing_invoice(uuid,uuid,uuid[],date) to service_role;

create or replace function public.fleet_mark_cte_batch_paid(
  p_company uuid,
  p_farm uuid,
  p_document_ids uuid[],
  p_receipt jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if p_document_ids is null
    or cardinality(p_document_ids) < 1
    or cardinality(p_document_ids) > 50
    or (select count(distinct value) from unnest(p_document_ids) as ids(value)) <> cardinality(p_document_ids)
  then
    raise exception 'Seleção de CT-es inválida.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_receipt) <> 'object'
    or nullif(p_receipt ->> 'id', '') is null
    or nullif(p_receipt ->> 'uploadedBy', '') is null
    or nullif(p_receipt ->> 'objectKey', '') is null
    or nullif(p_receipt ->> 'paidAt', '') is null
  then
    raise exception 'Comprovante inválido.' using errcode = '22023';
  end if;

  update public.fleet_cte_documents
  set payment_receipt = p_receipt
  where company_id = p_company
    and farm_id = p_farm
    and id = any(p_document_ids)
    and payment_receipt is null
    and cargo_weight is not null
    and billable_tons is not null
    and billing_amount is not null;

  get diagnostics updated_count = row_count;
  if updated_count <> cardinality(p_document_ids) then
    raise exception 'Um ou mais CT-es já foram pagos, não pertencem à fazenda ou estão sem peso.' using errcode = 'P0001';
  end if;

  return p_document_ids;
end;
$$;

revoke all on function public.fleet_mark_cte_batch_paid(uuid, uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.fleet_mark_cte_batch_paid(uuid, uuid, uuid[], jsonb) to service_role;

commit;
