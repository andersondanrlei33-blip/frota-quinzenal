create index if not exists fleet_cte_billing_invoices_issued_by_idx
  on public.fleet_cte_billing_invoices (issued_by);

create index if not exists fleet_cte_report_preferences_company_idx
  on public.fleet_cte_report_preferences (company_id);

create index if not exists fleet_cte_requests_document_idx
  on public.fleet_cte_requests (cte_document_id);

create index if not exists fleet_cte_requests_rejected_by_idx
  on public.fleet_cte_requests (rejected_by);

create index if not exists fleet_cte_requests_requested_by_idx
  on public.fleet_cte_requests (requested_by);

create index if not exists fleet_funding_receipts_uploaded_by_idx
  on public.fleet_funding_receipts (uploaded_by);
