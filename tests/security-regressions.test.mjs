import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudClient} from '../frontend/cloud-client.js';
import {createReceiptApi} from '../server/receipts.js';
import {billableTons,matchingInvoiceWeight} from '../server/ctes.js';
import {reconstructPdfPage} from '../server/pdf-text.js';
import {createSupabaseBackend} from '../server/supabase-adapter.js';

const connection={url:'https://example.supabase.co',publishableKey:'dummy-public-key'};
const storageKey='frota-session-v1:example.supabase.co:fleet-api';
const token=account=>({access_token:'dummy-'+account,refresh_token:'dummy-refresh-'+account,expires_in:3600});
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function sessionStorage(expired=false){
 const values=new Map();if(expired)values.set(storageKey,JSON.stringify({session:{...token('a'),expires_at:0},companyId:''}));
 return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}

for(const status of [200,400,401,500])test(`late refresh ${status} cannot replace or clear a newer login`,async()=>{
 const started=deferred(),refresh=deferred(),storage=sessionStorage(true),calls=[];
 const client=createCloudClient({...connection,storage,fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.includes('grant_type=refresh_token')){started.resolve();return refresh.promise;}
  if(url.includes('grant_type=password'))return Response.json(token('b'));
  return Response.json({account:'b'});
 }});
 const waiting=client.version(),rejected=assert.rejects(waiting,error=>error.code==='SESSION_CHANGED');
 await started.promise;client.forgetSession();await client.login('b@example.test','dummy-password');
 refresh.resolve(Response.json(status===200?token('a'):{error:'dummy failure'},{status}));await rejected;
 assert.equal(JSON.parse(storage.getItem(storageKey)).session.access_token,'dummy-b');
 await client.load();assert.equal(calls.at(-1).options.headers.Authorization,'Bearer dummy-b');
});

test('logout clears locally before its response and its late failure leaves a new login intact',async()=>{
 const started=deferred(),logout=deferred(),storage=sessionStorage(),calls=[];
 const client=createCloudClient({...connection,storage,fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.includes('/logout?')){started.resolve();return logout.promise;}
  if(url.includes('grant_type=password'))return Response.json(token(JSON.parse(options.body).email.startsWith('a@')?'a':'b'));
  return Response.json({});
 }});
 await client.login('a@example.test','dummy-password');
 const leaving=client.logout(),rejected=assert.rejects(leaving,error=>error.code==='SESSION_CHANGED');
 assert.equal(client.hasSession(),false);assert.equal(storage.getItem(storageKey),null);await started.promise;
 await client.login('b@example.test','dummy-password');logout.resolve(Response.json({error:'dummy failure'},{status:401}));await rejected;
 assert.equal(JSON.parse(storage.getItem(storageKey)).session.access_token,'dummy-b');
 assert.equal(calls.find(call=>call.url.includes('/logout?')).options.headers.Authorization,'Bearer dummy-a');
});

test('an old authenticated response is rejected after leaving and re-entering the same account',async()=>{
 const started=deferred(),held=deferred(),storage=sessionStorage();
 const client=createCloudClient({...connection,storage,fetchImpl:async url=>{
  if(url.includes('grant_type=password'))return Response.json(token('a'));
  if(url.endsWith('/api/ctes')){started.resolve();return held.promise;}
  return Response.json({});
 }});
 await client.login('a@example.test','dummy-password');const waiting=client.ctes(),rejected=assert.rejects(waiting,error=>error.code==='SESSION_CHANGED');
 await started.promise;client.forgetSession();await client.login('a@example.test','dummy-password');
 held.resolve(Response.json({documents:[{id:'dummy-private-a'}]}));await rejected;
});

test('an upload waiting for an old refresh never uses the next account token',async()=>{
 const started=deferred(),refresh=deferred(),calls=[],storage=sessionStorage(true);
 const client=createCloudClient({...connection,storage,fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.includes('grant_type=refresh_token')){started.resolve();return refresh.promise;}
  return Response.json(url.includes('grant_type=password')?token('b'):{});
 }});
 const waiting=client.uploadReceipt('dummy-request',new File(['%PDF-dummy'],'dummy.pdf'));
 const rejected=assert.rejects(waiting,error=>error.code==='SESSION_CHANGED');await started.promise;
 await client.login('b@example.test','dummy-password');refresh.resolve(Response.json(token('a')));await rejected;
 assert.equal(calls.some(call=>call.url.endsWith('/api/receipts')),false);
});

test('current refresh rejection notifies the UI and clears the saved session',async()=>{
 const storage=sessionStorage(true),client=createCloudClient({...connection,storage,fetchImpl:async()=>Response.json({error:'dummy expired'},{status:401})});
 let invalidations=0;client.onSessionInvalidated(()=>invalidations++);
 await assert.rejects(client.load());assert.equal(client.hasSession(),false);assert.equal(storage.getItem(storageKey),null);assert.equal(invalidations,1);
});

test('ordinary and funding receipts reject farm scopes before looking up or signing a private object',async()=>{
 const id='33333333-3333-4333-8333-333333333333';let actor,reads=0,signs=0;
 const state={paymentRequests:[{id:'dummy-payment',payment:{receipt:{id}},paymentHistory:[]}],fundingTransfers:[{id:'dummy-funding',receipt:{id}}]};
 const backend={actor:async()=>actor,responseJson:(value,status=200)=>Response.json(value,{status}),repository:{load:async()=>{reads++;return {state};}},
  receipts:{find:async()=>({id,requestId:'dummy-payment',name:'dummy.pdf'}),sign:async()=>{signs++;return 'https://example.test/dummy';}},
  fundingReceipts:{find:async()=>({id,transferId:'dummy-funding',name:'dummy.pdf'}),sign:async()=>{signs++;return 'https://example.test/dummy';}}
 };
 const api=createReceiptApi({backend});
 for(const route of ['receipts','funding-receipts'])for(const role of ['operator','viewer'])for(const scope of [{farmId:'dummy-farm'},{farmIds:['dummy-a','dummy-b']}]){
  actor={userId:'dummy-user',companyId:'dummy-company',party:'farm',role,...scope};
  assert.equal((await api(new Request(`https://example.test/api/${route}/${id}`))).status,403);
 }
 assert.equal(reads,0);assert.equal(signs,0);
 for(const party of ['group','carrier'])for(const role of ['admin','operator','viewer']){
  actor={userId:'dummy-user',companyId:'dummy-company',party,role};
  backend.receipts.find=async()=>({id,requestId:'dummy-payment',name:'dummy.pdf'});
  assert.equal((await api(new Request(`https://example.test/api/receipts/${id}`))).status,200);
  backend.receipts.find=async()=>null;
  assert.equal((await api(new Request(`https://example.test/api/funding-receipts/${id}`))).status,200);
 }
 actor=null;assert.equal((await api(new Request(`https://example.test/api/receipts/${id}`))).status,401);
});

test('unknown weight stays distinct from explicit zero',()=>{
 for(const weight of [null,undefined,'',NaN,-1])assert.equal(billableTons(weight,'kg'),null);
 assert.equal(billableTons(0,'kg'),0);assert.equal(billableTons(1000,'kg'),1);assert.equal(billableTons(1,'t'),1);
});

test('weight alternatives deduplicate sums and stop within a fixed amount of work',()=>{
 assert.deepEqual(matchingInvoiceWeight([[1000,2000],[1000,3000]],5000),{limited:false,matchingTotal:5000});
 assert.deepEqual(matchingInvoiceWeight(Array.from({length:20},()=>[0,1]),10),{limited:false,matchingTotal:10});
 assert.equal(matchingInvoiceWeight(Array.from({length:10},(_,index)=>[0,1,2,3].map(value=>value*4**index)),1).limited,true);
});

test('PDF reconstruction preserves row tolerance and horizontal ordering with bounded input',()=>{
 const item=(text,x,y)=>({str:text,transform:[1,0,0,1,x,y]});
 assert.equal(reconstructPdfPage([item('right',30,10),item('left',0,10),item('near',50,8),item('next',0,7),{str:'  '}]),'left right near\nnext');
 assert.equal(reconstructPdfPage(Array.from({length:400},(_,index)=>item('x',0,index*3))).split('\n').length,400);
 assert.throws(()=>reconstructPdfPage(Array.from({length:20001},()=>item('x',0,1))),/texto demais/);
 assert.throws(()=>reconstructPdfPage([item('x',0,NaN)]),/posições/);
});

test('the backend computes the document digest from bytes and preserves the first upload on a duplicate',async()=>{
 const rows=[],removed=[],hashes=new Set(),company='11111111-1111-4111-8111-111111111111';
 const backend=createSupabaseBackend({url:connection.url,publicKey:'dummy-public',secretKey:'dummy-server',fetchImpl:async(url,options)=>{
  if(url.endsWith('/rest/v1/fleet_cte_documents')){
   const row=JSON.parse(options.body);if(hashes.has(row.content_sha256))return Response.json({code:'23505',message:'dummy duplicate'},{status:409});
   hashes.add(row.content_sha256);rows.push(row);return Response.json({});
  }
  if(options.method==='DELETE'){removed.push(...JSON.parse(options.body).prefixes);return Response.json({});}
  if(options.method==='POST'&&url.includes('/storage/v1/object/'))return Response.json({});
  throw Error('Unexpected transport');
 }});
 const bytes=new TextEncoder().encode('%PDF-dummy-document'),actor={userId:'22222222-2222-4222-8222-222222222222',companyId:company};
 const metadata={number:'',farmId:'dummy-farm',truckId:'dummy-truck',issuedOn:'2026-11-01',content_sha256:'forged-client-hash'},details={name:'dummy.pdf',extension:'pdf',mime:'application/pdf',size:bytes.length},snapshot={plate:'AAA1A00',driver:'Dummy Driver',farmName:'Dummy Farm'};
 await backend.ctes.upload(actor,metadata,bytes,details,snapshot);
 await assert.rejects(backend.ctes.upload(actor,metadata,bytes,details,snapshot),/já foi enviado/);
 assert.equal(rows.length,1);assert.match(rows[0].content_sha256,/^[a-f0-9]{64}$/);assert.notEqual(rows[0].content_sha256,metadata.content_sha256);
 assert.equal(removed.length,1);assert.notEqual(removed[0],rows[0].object_key);
});

test('legacy derived zero with no source weight cannot reach the billing RPC',async()=>{
 let rpcCalls=0,savedWeight;
 const backend=createSupabaseBackend({url:connection.url,publicKey:'dummy-public',secretKey:'dummy-server',fetchImpl:async(url,options)=>{
  if(url.includes('/rpc/')){rpcCalls++;throw Error('Unexpected billing RPC');}
  if(options.method==='PATCH'){savedWeight=JSON.parse(options.body);return new Response(null,{status:204});}
  return Response.json([{id:'33333333-3333-4333-8333-333333333333',cargo_weight:null,billable_tons:0,billing_amount:0}]);
 }});
 const actor={userId:'dummy-admin',companyId:'dummy-company',party:'group',role:'operator'};
 await assert.rejects(backend.ctes.issueBillingInvoice(actor,['33333333-3333-4333-8333-333333333333'],'2026-11-30'),error=>error.status===409);
 assert.equal(rpcCalls,0);await backend.ctes.saveWeight('dummy-company','dummy-document',null,null);
 assert.equal(savedWeight.billable_tons,null);assert.equal(savedWeight.billing_amount,null);assert.equal(savedWeight.cargo_weight,null);
});
