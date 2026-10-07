import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudClient} from '../frontend/cloud-client.js';
const options={url:'https://example.supabase.co',publishableKey:'public-test-key'};
test('login and records use the server and a new browser session starts without local credentials or records',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return Response.json(url.includes('/auth/v1/')?{access_token:'test-token',refresh_token:'refresh-token',expires_in:3600}:{revision:2,state:{trucks:[]}});};
  const client=createCloudClient({...options,fetchImpl});assert.equal(client.hasSession(),false);await client.login('user@example.test','test-password');assert.equal(client.hasSession(),true);
  await client.execute('farm.status',{id:'farm1',active:false},2);assert.equal(calls.at(-1).options.headers.Authorization,'Bearer test-token');assert.equal(calls.at(-1).options.cache,'no-store');
  assert.equal(createCloudClient({...options,fetchImpl}).hasSession(),false);await client.logout();assert.equal(client.hasSession(),false);
});
test('a failed server write is reported rather than claiming it was saved',async()=>{
  let writes=0;const fetchImpl=async(url)=>{if(url.includes('/auth/v1/'))return Response.json({access_token:'test-token',refresh_token:'refresh-token'});if(url.endsWith('/api/commands')){writes++;return Response.json({error:'Outra pessoa atualizou os registros.'},{status:409});}return Response.json({revision:0,state:{trucks:[]}});};
  const client=createCloudClient({...options,fetchImpl});await client.login('user@example.test','test-password');await assert.rejects(client.execute('period.close',{month:'2026-10',half:1},0),error=>error.status===409);assert.equal(writes,1);
});
