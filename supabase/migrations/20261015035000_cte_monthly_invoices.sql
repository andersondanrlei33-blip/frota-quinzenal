create table public.fleet_cte_billing_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number bigint generated always as identity unique,
  company_id uuid not null references public.fleet_companies(id) on delete cascade,
  billing_month date not null check (extract(day from billing_month) = 1),
  due_on date not null,
  total_tons numeric(16,3) not null check (total_tons >= 0),
  total_amount numeric(16,2) not null check (total_amount >= 0),
  status text not null default 'open' check (status in ('open', 'paid')),
  payment_receipt jsonb check (payment_receipt is null or (jsonb_typeof(payment_receipt) = 'object' and payment_receipt ? 'objectKey' and payment_receipt ? 'uploadedBy' and payment_receipt ? 'paidAt')),
  issued_by uuid not null references auth.users(id),
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  check ((status = 'open' and payment_receipt is null and paid_at is null) or (status = 'paid' and payment_receipt is not null and paid_at is not null)),
  check (payment_receipt is null or payment_receipt->>'objectKey' like company_id::text || '/cte-billing/invoices/%')
);

create index fleet_cte_billing_invoices_company_month_idx
  on public.fleet_cte_billing_invoices(company_id, billing_month desc, invoice_number desc);

create table public.fleet_cte_billing_invoice_items (
  invoice_id uuid not null references public.fleet_cte_billing_invoices(id) on delete cascade,
  document_id uuid not null unique references public.fleet_cte_documents(id) on delete restrict,
  primary key (invoice_id, document_id)
);

create index fleet_cte_billing_invoice_items_document_idx
  on public.fleet_cte_billing_invoice_items(document_id);

alter table public.fleet_cte_billing_invoices enable row level security;
alter table public.fleet_cte_billing_invoice_items enable row level security;
revoke all on public.fleet_cte_billing_invoices, public.fleet_cte_billing_invoice_items from anon, authenticated;
grant all on public.fleet_cte_billing_invoices, public.fleet_cte_billing_invoice_items to service_role;

create or replace function public.fleet_issue_cte_billing_invoice(
  p_company uuid,
  p_actor uuid,
  p_document_ids uuid[],
  p_due_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_count integer;
  eligible_count integer;
  month_count integer;
  invoice_month date;
  tons numeric(16,3);
  amount numeric(16,2);
  invoice_row public.fleet_cte_billing_invoices%rowtype;
begin
  if p_document_ids is null or cardinality(p_document_ids) < 1 or cardinality(p_document_ids) > 500
    or (select count(distinct value) from unnest(p_document_ids) as ids(value)) <> cardinality(p_document_ids)
  then raise exception 'Seleção de CT-es inválida.' using errcode = '22023'; end if;
  if p_due_on is null or p_due_on < current_date then raise exception 'Vencimento inválido.' using errcode = '22023'; end if;

  perform 1 from public.fleet_cte_documents d
   where d.company_id = p_company and d.id = any(p_document_ids)
   order by d.id for update;

  select count(*), count(*) filter (where d.billable_tons is not null and d.billing_amount is not null and d.payment_receipt is null),
         count(distinct date_trunc('month', d.issued_on)), min(date_trunc('month', d.issued_on)::date),
         coalesce(sum(d.billable_tons), 0), coalesce(sum(d.billing_amount), 0)
    into selected_count, eligible_count, month_count, invoice_month, tons, amount
    from public.fleet_cte_documents d
   where d.company_id = p_company and d.id = any(p_document_ids);
  if selected_count <> cardinality(p_document_ids) then raise exception 'Um ou mais CT-es não pertencem à empresa.' using errcode = 'P0001'; end if;
  if eligible_count <> selected_count then raise exception 'Um ou mais CT-es já foram pagos ou estão sem peso identificado.' using errcode = 'P0001'; end if;
  if month_count <> 1 then raise exception 'Selecione CT-es de uma única competência mensal.' using errcode = 'P0001'; end if;
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
$$;

create or replace function public.fleet_pay_cte_billing_invoice(
  p_company uuid,
  p_invoice_id uuid,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.fleet_cte_billing_invoices%rowtype;
  item_count integer;
  updated_count integer;
begin
  if jsonb_typeof(p_receipt) <> 'object' or nullif(p_receipt->>'id', '') is null
    or nullif(p_receipt->>'uploadedBy', '') is null or nullif(p_receipt->>'objectKey', '') is null
    or nullif(p_receipt->>'paidAt', '') is null
    or p_receipt->>'objectKey' not like p_company::text || '/cte-billing/invoices/%'
  then raise exception 'Comprovante inválido.' using errcode = '22023'; end if;

  select * into invoice_row from public.fleet_cte_billing_invoices
   where id = p_invoice_id and company_id = p_company for update;
  if not found or invoice_row.status <> 'open' or invoice_row.payment_receipt is not null then
    raise exception 'Fatura não encontrada ou já quitada.' using errcode = 'P0001';
  end if;
  select count(*) into item_count from public.fleet_cte_billing_invoice_items where invoice_id = invoice_row.id;
  if item_count < 1 then raise exception 'Fatura sem CT-es.' using errcode = 'P0001'; end if;

  update public.fleet_cte_documents d set payment_receipt = p_receipt
   where d.company_id = p_company and d.payment_receipt is null
     and d.id in (select i.document_id from public.fleet_cte_billing_invoice_items i where i.invoice_id = invoice_row.id);
  get diagnostics updated_count = row_count;
  if updated_count <> item_count then raise exception 'Um ou mais CT-es da fatura já têm baixa de pagamento.' using errcode = 'P0001'; end if;

  update public.fleet_cte_billing_invoices set status = 'paid', payment_receipt = p_receipt,
    paid_at = (p_receipt->>'paidAt')::timestamptz
   where id = invoice_row.id and company_id = p_company and status = 'open';
  return jsonb_build_object('id', invoice_row.id, 'status', 'paid', 'paidAt', p_receipt->>'paidAt');
end;
$$;

revoke all on function public.fleet_issue_cte_billing_invoice(uuid, uuid, uuid[], date) from public, anon, authenticated;
grant execute on function public.fleet_issue_cte_billing_invoice(uuid, uuid, uuid[], date) to service_role;
revoke all on function public.fleet_pay_cte_billing_invoice(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fleet_pay_cte_billing_invoice(uuid, uuid, jsonb) to service_role;
