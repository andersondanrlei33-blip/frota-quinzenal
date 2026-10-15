alter table public.fleet_cte_documents
  add column billing_rate numeric(8,2) not null default 2.70,
  add column billable_tons numeric(14,3),
  add column billing_amount numeric(14,2),
  add column payment_receipt jsonb;

alter table public.fleet_cte_documents
  add constraint fleet_cte_documents_billing_rate_check
    check (billing_rate > 0 and billing_rate <= 10000),
  add constraint fleet_cte_documents_billable_tons_check
    check (billable_tons is null or billable_tons >= 0),
  add constraint fleet_cte_documents_billing_amount_check
    check (billing_amount is null or billing_amount >= 0),
  add constraint fleet_cte_documents_payment_receipt_check
    check (payment_receipt is null or (jsonb_typeof(payment_receipt) = 'object' and payment_receipt ? 'objectKey' and payment_receipt ? 'uploadedBy' and payment_receipt ? 'paidAt'));

update public.fleet_cte_documents
set billable_tons = round(case when cargo_weight_unit = 't' then cargo_weight else cargo_weight / 1000 end, 3),
    billing_amount = round((case when cargo_weight_unit = 't' then cargo_weight else cargo_weight / 1000 end) * billing_rate, 2)
where cargo_weight is not null and cargo_weight >= 0;
