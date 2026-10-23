alter table public.fleet_cte_documents
  alter column billing_rate set default 2.50;

update public.fleet_cte_documents
set billing_rate = 2.50,
    billing_amount = case
      when billable_tons is null then null
      else round(billable_tons * 2.50, 2)
    end
where payment_receipt is null
  and not exists (
    select 1
    from public.fleet_cte_billing_invoice_items item
    join public.fleet_cte_billing_invoices invoice on invoice.id = item.invoice_id
    where item.document_id = fleet_cte_documents.id
      and invoice.status = 'paid'
  );

update public.fleet_cte_billing_invoices invoice
set total_amount = coalesce((
  select sum(document.billing_amount)
  from public.fleet_cte_billing_invoice_items item
  join public.fleet_cte_documents document on document.id = item.document_id
  where item.invoice_id = invoice.id
), 0)
where invoice.status = 'open'
  and exists (
  select 1
  from public.fleet_cte_billing_invoice_items item
  where item.invoice_id = invoice.id
);
