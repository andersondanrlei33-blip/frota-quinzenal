alter table public.fleet_cte_documents
  add column shipper text not null default 'Não identificado'
    check(length(shipper) between 1 and 160),
  add column service_taker text not null default 'Não identificado'
    check(length(service_taker) between 1 and 160);

alter table public.fleet_cte_documents
  alter column shipper drop default,
  alter column service_taker drop default;
