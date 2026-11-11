-- NOT EXECUTED. Run only against a disposable local schema with audit-remediation.sql applied,
-- inside the approved offline OS sandbox. The transaction uses only dummy identities and rolls back.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('aaaaaaaa-0000-4000-8000-000000000001','dummy-admin@example.test',now()),
 ('aaaaaaaa-0000-4000-8000-000000000002','dummy-staff@example.test',now());
insert into public.fleet_companies(id,name) values
 ('bbbbbbbb-0000-4000-8000-000000000001','Dummy company A'),
 ('bbbbbbbb-0000-4000-8000-000000000002','Dummy company B');
insert into public.fleet_records(company_id,kind,record_id,data) values
 ('bbbbbbbb-0000-4000-8000-000000000001','farm','dummy-farm-a','{"id":"dummy-farm-a","name":"Dummy farm A"}'),
 ('bbbbbbbb-0000-4000-8000-000000000001','farm','dummy-farm-b','{"id":"dummy-farm-b","name":"Dummy farm B"}');
insert into public.fleet_members(company_id,user_id,email,role,party,farm_id) values
 ('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','dummy-admin@example.test','admin','group',null),
 ('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','dummy-staff@example.test','operator','farm','dummy-farm-a');
insert into public.fleet_invitations(company_id,email,role,party,token_hash,expires_at,consumed_at) values
 ('bbbbbbbb-0000-4000-8000-000000000001','DUMMY-STAFF@example.test','admin','group',repeat('a',64),now()+interval '1 day',null),
 ('bbbbbbbb-0000-4000-8000-000000000001','dummy-staff@example.test','admin','group',repeat('b',64),now()+interval '1 day',now()),
 ('bbbbbbbb-0000-4000-8000-000000000002','dummy-staff@example.test','admin','group',repeat('c',64),now()+interval '1 day',null);

do $$
declare outcome jsonb;
begin
 if public.fleet_inspect_invitation(repeat('a',64)) is null then raise exception 'Dummy invitation should start valid'; end if;
 perform public.fleet_change_member('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','viewer',false,'farm','dummy-farm-b','{}');
 if public.fleet_inspect_invitation(repeat('a',64)) is not null then raise exception 'Old invitation remained inspectable'; end if;
 begin
  perform public.fleet_accept_invitation(repeat('a',64),'aaaaaaaa-0000-4000-8000-000000000002','dummy-staff@example.test');
  raise exception 'Old invitation unexpectedly restored access';
 exception when invalid_parameter_value then null;
 end;
 if not exists(select 1 from public.fleet_members where user_id='aaaaaaaa-0000-4000-8000-000000000002' and company_id='bbbbbbbb-0000-4000-8000-000000000001' and role='viewer' and not active and farm_id='dummy-farm-b') then raise exception 'Administrative restriction was lost'; end if;
 if not exists(select 1 from public.fleet_invitations where token_hash=repeat('a',64) and revoked_at is not null and consumed_at is null and expires_at>now()) then raise exception 'Revocation overwrote history'; end if;
 if exists(select 1 from public.fleet_invitations where token_hash in (repeat('b',64),repeat('c',64)) and revoked_at is not null) then raise exception 'Unrelated or consumed invitation changed'; end if;
 if not exists(select 1 from public.fleet_audit where action='team.updated' and changes->'revokedInvitationIds' is not null) then raise exception 'Revocation audit is absent'; end if;
 if has_function_privilege('anon','public.fleet_accept_invitation(text,uuid,text,text)','execute') or has_function_privilege('authenticated','public.fleet_accept_invitation(text,uuid,text,text)','execute') then raise exception 'Invitation RPC exposed to clients'; end if;
end $$;

-- A newly issued grant after the restriction may intentionally reactivate the recipient.
insert into public.fleet_invitations(company_id,email,role,party,farm_id,token_hash,expires_at)
 values ('bbbbbbbb-0000-4000-8000-000000000001','dummy-staff@example.test','operator','farm','dummy-farm-b',repeat('d',64),now()+interval '1 day');
select public.fleet_accept_invitation(repeat('d',64),'aaaaaaaa-0000-4000-8000-000000000002','dummy-staff@example.test');
do $$ begin
 if not exists(select 1 from public.fleet_members where user_id='aaaaaaaa-0000-4000-8000-000000000002' and company_id='bbbbbbbb-0000-4000-8000-000000000001' and active and role='operator' and farm_id='dummy-farm-b') then raise exception 'Fresh grant did not preserve intended reactivation'; end if;
end $$;

-- Same-byte uploads are unique within a company, including documents with no nCT/request.
insert into public.fleet_cte_documents(id,company_id,farm_id,farm_name,truck_id,plate,driver,cte_number,issued_on,uploaded_by,object_key,file_name,content_type,size_bytes,shipper,service_taker,issuer,recipient,total_value,cargo_weight,billable_tons,billing_amount,content_sha256)
 values ('cccccccc-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','dummy-farm-b','Dummy farm B','dummy-truck','AAA1A00','Dummy Driver',null,'2026-11-01','aaaaaaaa-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000001/ctes/dummy-a/cte.pdf','dummy.pdf','application/pdf',16,'Dummy Shipper','Dummy Service Taker','Dummy Issuer','Dummy Recipient',100,null,0,0,repeat('e',64));
do $$ begin
 begin
  insert into public.fleet_cte_documents(id,company_id,farm_id,farm_name,truck_id,plate,driver,cte_number,issued_on,uploaded_by,object_key,file_name,content_type,size_bytes,shipper,service_taker,issuer,recipient,total_value,content_sha256)
   values ('cccccccc-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000001','dummy-farm-b','Dummy farm B','dummy-truck','AAA1A00','Dummy Driver',null,'2026-11-01','aaaaaaaa-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000001/ctes/dummy-b/cte.pdf','dummy.pdf','application/pdf',16,'Dummy Shipper','Dummy Service Taker','Dummy Issuer','Dummy Recipient',100,repeat('e',64));
  raise exception 'Duplicate bytes were accepted' using errcode='XX000';
 exception when unique_violation then null;
 end;
 begin
  perform public.fleet_issue_cte_billing_invoice('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',array['cccccccc-0000-4000-8000-000000000001'::uuid],'2099-01-01');
  raise exception 'Unknown weight reached an invoice' using errcode='XX000';
 exception when sqlstate 'P0001' then null;
 end;
end $$;
-- Explicit zero remains distinct and eligible under the existing business rule.
update public.fleet_cte_documents set cargo_weight=0,cargo_weight_unit='kg'
 where id='cccccccc-0000-4000-8000-000000000001';
select public.fleet_issue_cte_billing_invoice('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',array['cccccccc-0000-4000-8000-000000000001'::uuid],'2099-01-01');
rollback;
