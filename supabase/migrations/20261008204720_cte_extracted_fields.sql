alter table public.fleet_cte_documents
  add column issuer text not null default 'Não identificado'
    check(length(issuer) between 1 and 160),
  add column recipient text not null default 'Não identificado'
    check(length(recipient) between 1 and 160),
  add column total_value numeric(14,2) not null default 0
    check(total_value >= 0);

alter table public.fleet_cte_documents
  alter column issuer drop default,
  alter column recipient drop default,
  alter column total_value drop default;
