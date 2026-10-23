alter table public.fleet_cte_documents
  alter column billing_rate set default 2.50;

update public.fleet_cte_documents
set billing_rate = 2.50,
    billing_amount = case
      when billable_tons is null then null
      else round(billable_tons * 2.50, 2)
    end;

update public.fleet_cte_billing_invoices invoice
set total_amount = coalesce((
  select sum(document.billing_amount)
  from public.fleet_cte_billing_invoice_items item
  join public.fleet_cte_documents document on document.id = item.document_id
  where item.invoice_id = invoice.id
), 0)
where exists (
  select 1
  from public.fleet_cte_billing_invoice_items item
  where item.invoice_id = invoice.id
);
