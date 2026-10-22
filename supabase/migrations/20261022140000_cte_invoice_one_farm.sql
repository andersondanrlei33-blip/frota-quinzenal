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
         count(*) filter (where d.billable_tons is not null and d.billing_amount is not null and d.payment_receipt is null),
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
