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
