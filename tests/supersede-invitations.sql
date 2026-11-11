-- Run against a disposable local database after all migrations. No live identities.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('aaaaaaaa-0000-4000-8000-000000000011','issue-admin@example.test',now()),
 ('aaaaaaaa-0000-4000-8000-000000000012','issue-staff@example.test',now());
insert into public.fleet_companies(id,name) values
 ('bbbbbbbb-0000-4000-8000-000000000011','Issue company A'),
 ('bbbbbbbb-0000-4000-8000-000000000012','Issue company B');
insert into public.fleet_members(company_id,user_id,email,role,party) values
 ('bbbbbbbb-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000011','issue-admin@example.test','admin','group');
insert into public.fleet_invitations(company_id,email,role,party,token_hash,expires_at,consumed_at) values
 ('bbbbbbbb-0000-4000-8000-000000000011','ISSUE-STAFF@example.test','admin','group',repeat('a',64),now()+interval '1 day',null),
 ('bbbbbbbb-0000-4000-8000-000000000011','issue-staff@example.test','operator','group',repeat('b',64),now()+interval '1 day',now()),
 ('bbbbbbbb-0000-4000-8000-000000000012','issue-staff@example.test','operator','group',repeat('c',64),now()+interval '1 day',null);

set local role service_role;
select public.fleet_issue_invitation(
 'bbbbbbbb-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000011',
 'issue-staff@example.test','viewer','group',null,'{}',repeat('d',64));
do $$ begin
 if public.fleet_inspect_invitation(repeat('a',64)) is not null then raise exception 'Previous link still works'; end if;
 if public.fleet_inspect_invitation(repeat('d',64)) is null then raise exception 'New link does not work'; end if;
 if public.fleet_inspect_invitation(repeat('c',64)) is null then raise exception 'Other company link changed'; end if;
 if exists(select 1 from public.fleet_invitations where token_hash in (repeat('b',64),repeat('c',64)) and revoked_at is not null) then raise exception 'Consumed or unrelated link changed'; end if;
 begin
  perform public.fleet_accept_invitation(repeat('a',64),'aaaaaaaa-0000-4000-8000-000000000012','issue-staff@example.test');
  raise exception 'Revoked link unexpectedly accepted';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.fleet_issue_invitation('bbbbbbbb-0000-4000-8000-000000000011',
    'aaaaaaaa-0000-4000-8000-000000000012','issue-staff@example.test',
    'admin','group',null,'{}',repeat('e',64));
  raise exception 'Non-admin issued an invitation';
 exception when insufficient_privilege then null;
 end;
 if public.fleet_inspect_invitation(repeat('d',64)) is null then raise exception 'Denied issue changed the valid link'; end if;
end $$;

select public.fleet_issue_invitation(
 'bbbbbbbb-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000011',
 'issue-staff@example.test','viewer','group',null,'{}',repeat('e',64));
do $$ begin
 if public.fleet_inspect_invitation(repeat('d',64)) is not null then raise exception 'Second issue did not supersede the first'; end if;
 if not exists(select 1 from public.fleet_audit where action='team.invited' and changes->>'email'='issue-staff@example.test' and changes->'revokedInvitationIds' is not null) then raise exception 'Invitation audit missing'; end if;
 if has_function_privilege('anon','public.fleet_issue_invitation(uuid,uuid,text,text,text,text,text[],text)','execute')
    or has_function_privilege('authenticated','public.fleet_issue_invitation(uuid,uuid,text,text,text,text,text[],text)','execute')
 then raise exception 'Issue RPC exposed to clients'; end if;
end $$;
select public.fleet_accept_invitation(repeat('e',64),
 'aaaaaaaa-0000-4000-8000-000000000012','issue-staff@example.test');
do $$ begin
 if not exists(select 1 from public.fleet_members where company_id='bbbbbbbb-0000-4000-8000-000000000011'
   and user_id='aaaaaaaa-0000-4000-8000-000000000012' and role='viewer' and active)
 then raise exception 'Newest invitation failed to create intended access'; end if;
end $$;
rollback;
