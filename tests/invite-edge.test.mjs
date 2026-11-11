import test from 'node:test';
import assert from 'node:assert/strict';

test('team invitation route uses the atomic issue RPC and returns its expiry',async()=>{
  const originalDeno=globalThis.Deno,originalFetch=globalThis.fetch;
  let handle,issued;
  globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'dummy-public',SUPABASE_SERVICE_ROLE_KEY:'dummy-secret'}[name])},serve:handler=>{handle=handler;}};
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:'aaaaaaaa-0000-4000-8000-000000000001',email:'admin@example.test',email_confirmed_at:'2026-01-01T00:00:00Z'});
    if(url.includes('/rest/v1/fleet_members?'))return Response.json([{company_id:'bbbbbbbb-0000-4000-8000-000000000001',user_id:'aaaaaaaa-0000-4000-8000-000000000001',email:'admin@example.test',role:'admin',party:'group',active:true}]);
    if(url.endsWith('/rest/v1/rpc/fleet_issue_invitation')){
      issued=JSON.parse(options.body);
      return Response.json({id:'cccccccc-0000-4000-8000-000000000001',expiresAt:'2026-11-12T03:00:00Z',revokedInvitationIds:[]});
    }
    throw Error('Unexpected backend call: '+url);
  };
  try{
    await import('../server/edge-api.js?invite-edge-test');
    const response=await handle(new Request('https://example.test/functions/v1/fleet-api/api/team/invite',{
      method:'POST',headers:{Authorization:'Bearer dummy','Content-Type':'application/json'},
      body:JSON.stringify({email:'STAFF@example.test',role:'viewer',party:'group'})
    }));
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.expiresAt,'2026-11-12T03:00:00Z');
    assert.equal(result.email,'staff@example.test');
    assert.equal(issued.p_email,'staff@example.test');
    assert.equal(issued.p_actor,'aaaaaaaa-0000-4000-8000-000000000001');
    assert.match(issued.p_hash,/^[a-f0-9]{64}$/);
  }finally{globalThis.Deno=originalDeno;globalThis.fetch=originalFetch;}
});
