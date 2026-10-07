import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudClient} from '../frontend/cloud-client.js';
const options={url:'https://example.supabase.co',publishableKey:'public-test-key'};
test('login survives a page reload in the same tab and logout clears the session',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return Response.json(url.includes('/auth/v1/')?{access_token:'test-token',refresh_token:'refresh-token',expires_in:3600}:{revision:2,state:{trucks:[]}});};
  const client=createCloudClient({...options,fetchImpl,storage});assert.equal(client.hasSession(),false);await client.login('user@example.test','test-password');assert.equal(client.hasSession(),true);
  await client.execute('farm.status',{id:'farm1',active:false},2);assert.equal(calls.at(-1).options.headers.Authorization,'Bearer test-token');assert.equal(calls.at(-1).options.cache,'no-store');
  const reloaded=createCloudClient({...options,fetchImpl,storage});assert.equal(reloaded.hasSession(),true);await reloaded.load();assert.equal(calls.at(-1).options.headers.Authorization,'Bearer test-token');
  assert.doesNotMatch([...values.values()][0],/trucks|test-password/);
  await reloaded.logout();assert.equal(reloaded.hasSession(),false);assert.equal(values.size,0);
});
test('an expired session refreshes after reload and saves the rotated tokens',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(url.includes('grant_type=password'))return Response.json({access_token:'old-token',refresh_token:'old-refresh',expires_in:3600});
    if(url.includes('grant_type=refresh_token'))return Response.json({access_token:'new-token',refresh_token:'new-refresh',expires_in:3600});
    return Response.json({revision:2,state:{trucks:[]}});
  };
  await createCloudClient({...options,fetchImpl,storage}).login('user@example.test','test-password');
  const [key,raw]=values.entries().next().value,saved=JSON.parse(raw);saved.session.expires_at=0;values.set(key,JSON.stringify(saved));
  const reloaded=createCloudClient({...options,fetchImpl,storage});await reloaded.load();
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer new-token');
  assert.match([...values.values()][0],/new-refresh/);
});
test('a failed server write is reported rather than claiming it was saved',async()=>{
  let writes=0;const fetchImpl=async(url)=>{if(url.includes('/auth/v1/'))return Response.json({access_token:'test-token',refresh_token:'refresh-token'});if(url.endsWith('/api/commands')){writes++;return Response.json({error:'Outra pessoa atualizou os registros.'},{status:409});}return Response.json({revision:0,state:{trucks:[]}});};
  const client=createCloudClient({...options,fetchImpl});await client.login('user@example.test','test-password');await assert.rejects(client.execute('period.close',{month:'2026-10',half:1},0),error=>error.status===409);assert.equal(writes,1);
});
