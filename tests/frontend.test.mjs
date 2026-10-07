import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {initialState,period} from '../server/engine.js';
import {createFleetApi} from '../server/api.js';

const raw=name=>fs.readFileSync(new URL('../frontend/'+name,import.meta.url),'utf8').replace(/^import .*?;\r?\n/gm,'').replace(/^export /gm,'');
const code=[raw('engine.js'),raw('reports.js'),raw('cloud-client.js'),"const CLOUD_CONFIG={url:'https://example.supabase.co',publishableKey:'public-test-key'};",raw('cloud-ui.js'),raw('app.js')].join('\n');
function domNode(){const classes=new Set();return {innerHTML:'',textContent:'',value:'',disabled:false,required:false,hidden:false,open:false,id:'',dataset:{},attributes:{},classList:{add:(...items)=>items.forEach(item=>classes.add(item)),remove:(...items)=>items.forEach(item=>classes.delete(item)),toggle:(item,enabled)=>enabled?classes.add(item):classes.delete(item),contains:item=>classes.has(item)},setAttribute(key,value){this.attributes[key]=value;},setCustomValidity(value){this.validationMessage=value;},addEventListener(){},scrollIntoView(){},focus(){},setSelectionRange(){},showModal(){this.open=true;},close(){this.open=false;},insertAdjacentHTML(position,html){this.innerHTML+=html;}};}
async function boot(role='admin',activation=false,storage=null,party='group'){
  const nodes=new Map(),handlers=new Map(),get=selector=>{if(!nodes.has(selector)){const node=domNode();node.querySelector=get;nodes.set(selector,node);}return nodes.get(selector);};
  const document={body:domNode(),visibilityState:'visible',querySelector:get,querySelectorAll:()=>[],addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);}};get('#modal').querySelector=get;
  let stored={state:initialState(),revision:0,company:{id:'company-one',name:'Empresa de teste'}};
  let account={role,party};const proofs=new Map();
  const repository={async load(){return structuredClone(stored);},async version(){return stored.revision;},async commit(company,revision,state){if(revision!==stored.revision)return null;stored={...stored,state:structuredClone(state),revision:revision+1};return structuredClone(stored);}};
  repository.verifyReceipt=async(actor,id,requestId)=>{const proof=proofs.get(id);if(!proof||proof.requestId!==requestId)throw Error('Comprovante inválido.');return proof;};
  const api=createFleetApi({repository,authenticate:async request=>request.headers.get('Authorization')?{userId:account.party==='carrier'?'carrier-test':'group-test',companyId:'company-one',email:'user@example.test',...account}:null});
  const calls=[];
  const fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/api/receipts')){const id=crypto.randomUUID(),proof={id,requestId:options.body.get('requestId'),companyId:'company-one',uploadedBy:'carrier-test',name:options.body.get('file').name,mime:'application/pdf',size:options.body.get('file').size};proofs.set(id,proof);return Response.json(proof);}if(url.endsWith('/fleet-access')){const body=JSON.parse(options.body);return Response.json(body.action==='inspect'?{firstAccess:true,email:'',companyName:'Frota'}:{companyId:'company-one',role:'admin'});}if(url.includes('/auth/v1/token'))return Response.json({access_token:'fake-jwt',refresh_token:'fake-refresh',expires_in:3600});if(url.includes('/auth/v1/logout'))return Response.json({});if(url.endsWith('/api/team'))return Response.json({members:[]});if(url.endsWith('/api/team/invite'))return Response.json({email:'staff@example.test',role:'viewer',ticket:'b'.repeat(64)});return api(new Request(url,options));};
  class FormData {constructor(form){this.values=form?.data||new Map();}get(name){return this.values.get(name);}has(name){return this.values.has(name);}append(name,value){this.values.set(name,value);}}
  const sandbox=vm.createContext({document,window:{addEventListener(){},scrollTo(){},print(){}},location:{origin:'https://fleet.test',pathname:'/',hash:activation?'#activate='+'a'.repeat(64):'#overview'},sessionStorage:storage,localStorage:{getItem(){throw Error('Fleet records must not be stored in the browser');},setItem(){throw Error('Fleet records must not be stored in the browser');}},Intl,URL,Blob,Request,Response,FormData,crypto,structuredClone,fetch,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,console});
  vm.runInContext(code,sandbox,{timeout:1000});await new Promise(resolve=>setImmediate(resolve));
  const emit=async(type,event)=>{for(const handler of handlers.get(type)||[])await handler(event);};
  const submit=async(id,data,dataset={})=>{const error=domNode(),button=domNode(),form={id,dataset,data:new Map(Object.entries(data)),querySelector:selector=>selector==='[type="submit"]'?button:error};await emit('submit',{target:form,preventDefault(){}});return error.textContent;};
  const action=async(name,id='',extra={})=>emit('click',{target:{closest:()=>({disabled:false,dataset:{action:name,id,...extra}})}});
  return {get,submit,action,calls,run:source=>vm.runInContext(source,sandbox),state:()=>structuredClone(stored),account:(party,role='operator')=>{account={party,role};}};
}
test('the carrier portal returns after a page refresh and logout ends that tab session',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const first=await boot('operator',false,storage,'carrier');
  assert.equal(await first.submit('access-form',{email:'carrier@example.test',password:'test-password'}),'');
  assert.match(first.get('#main').innerHTML,/Pagamentos da transportadora/);
  const reloaded=await boot('operator',false,storage,'carrier');
  assert.match(reloaded.get('#main').innerHTML,/Pagamentos da transportadora/);
  assert.ok(reloaded.calls.some(call=>call.url.endsWith('/api/state')));
  await reloaded.action('cloud-logout');
  assert.equal(values.size,0);
  const signedOut=await boot('operator',false,storage,'carrier');
  assert.match(signedOut.get('#main').innerHTML,/Entrar no sistema/);
});
test('the online interface requires login, saves truck and payment commands on the server and survives a data reload',async()=>{
  const app=await boot();assert.match(app.get('#main').innerHTML,/Entrar no sistema/);
  assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');assert.match(app.get('#main').innerHTML,/Visão geral/);
  const today=app.run('today()'),month=today.slice(0,7);app.run(`currentMonth='${month}';currentHalf=1;`);
  assert.equal(await app.submit('truck-form',{plate:'ABC1D23',driver:'Motorista',carrier:'Transportador',farmId:'farm1',bodyType:'Caçamba',axles:'9',monthly:'30.000,00',start:month+'-01',end:'',paymentMethod:'pix',paymentHolder:'Motorista',paymentDocument:'12345678901',paymentPixKey:'motorista@example.com'}),'');
  const id=app.state().state.trucks[0].id;assert.equal(app.state().state.trucks.length,1);
  app.get('#closing-farm').value='farm1';await app.action('confirm-close');const closing=app.state().state.closings[0];assert.equal(closing.rows[0].net,15000);
  assert.match(await app.submit('payment-form',{date:today,note:'Teste'},{id}),/transportadora/);
  assert.equal(await app.submit('request-payments-form',{},{}),'');const requestId=app.state().state.paymentRequests[0].id;assert.equal(app.state().state.paymentRequests[0].snapshot.paymentDetails.pixKey,'motorista@example.com');
  await app.action('cloud-logout');app.account('carrier');await app.submit('access-form',{email:'carrier@example.test',password:'aB3!xY'});assert.match(app.get('#main').innerHTML,/Pagamentos da transportadora/);assert.equal(app.run('state.trucks.length'),0);
  assert.match(await app.submit('payment-form',{date:today,note:'Teste'},{requestId}),/comprovante/);
  const file=new File(['%PDF-1.4\nTechnical fixture'],'receipt.pdf',{type:'application/pdf'});
  assert.equal(await app.submit('payment-form',{date:today,note:'Teste',receipt:file},{requestId}),'');assert.equal(app.state().state.closings[0].rows[0].paid.date,today);
  await app.action('cloud-refresh');assert.equal(app.run('portalRequests[0].payment.date'),today);
  await app.action('cloud-logout');app.account('group','admin');await app.submit('access-form',{email:'group@example.test',password:'aB3!xY'});assert.equal(app.run('state.closings[0].rows[0].paid.date'),today);
  await app.action('cloud-logout');assert.match(app.get('#main').innerHTML,/Entrar no sistema/);assert.equal(app.run('state.trucks.length'),0);
  assert.ok(app.calls.filter(call=>call.url.includes('/api/commands')).every(call=>call.options.cache==='no-store'));
});
test('selecting a monetary discount requires an explanation and the submitted amount reaches the closing',async()=>{
 const app=await boot();await app.submit('access-form',{email:'user@example.test',password:'aB3!xY'});const date=app.run('today()'),month=date.slice(0,7);app.run(`currentMonth='${month}';currentHalf=1;`);
 await app.submit('truck-form',{plate:'ABC1D23',driver:'Motorista',carrier:'Transportador',farmId:'farm1',bodyType:'Caçamba',axles:'9',monthly:'30.000,00',start:month+'-01',end:''});const truckId=app.state().state.trucks[0].id;
 const form=app.get('#discount-form');form.id='discount-form';form.elements=Object.fromEntries(['kind','reason','start','end','date','amount','note'].map(name=>[name,domNode()]));form.elements.kind.value='amount';form.elements.reason.value='Falta';
 app.run("updateDiscountKind(document.querySelector('#discount-form'))");assert.equal(form.elements.note.required,true);assert.equal(form.elements.date.required,true);assert.equal(form.elements.start.disabled,true);assert.equal(form.querySelector('#discount-day-fields').hidden,true);
 const values={kind:'amount',truckId,date:month+'-07',amount:'500,25',note:''};assert.match(await app.submit('discount-form',values),/obrigatoriamente/);assert.equal(app.state().state.discounts.length,0);
 assert.equal(await app.submit('discount-form',{...values,note:'Adiantamento combinado'}),'');assert.equal(app.state().state.discounts[0].amount,500.25);
 app.get('#closing-farm').value='farm1';await app.action('confirm-close');const row=app.state().state.closings[0].rows[0];assert.equal(row.net,14499.75);assert.equal(row.payableDays,15);assert.equal(row.discountDays,0);
 form.elements.kind.value='days';form.elements.start.value=month+'-07';form.elements.end.value=month+'-08';app.run("updateDiscountKind(document.querySelector('#discount-form'))");assert.equal(form.elements.amount.disabled,true);assert.equal(form.elements.note.required,false);
});
test('a failed online write never changes the authoritative record or displays a saved confirmation',async()=>{
  const app=await boot('viewer');await app.submit('access-form',{email:'viewer@example.test',password:'a-long-test-password'});
  const today=app.run('today()');const error=await app.submit('truck-form',{plate:'ABC1D23',driver:'Motorista',carrier:'Transportador',farmId:'farm1',bodyType:'Caçamba',axles:'9',monthly:'30.000,00',start:today,end:''});
  assert.match(error,/consulta/);assert.equal(app.state().state.trucks.length,0);assert.doesNotMatch(app.get('#toast').textContent,/Cadastro salvo/);
});
test('first access collects company credentials and an administrator can generate a staff link',async()=>{
  const app=await boot('admin',true);assert.match(app.get('#main').innerHTML,/Configurar seu acesso/);assert.match(app.get('#main').innerHTML,/Nome da empresa/);assert.match(app.get('#main').innerHTML,/minlength="6"/);assert.match(app.get('#main').innerHTML,/pelo menos 6 caracteres/);
  assert.equal(await app.submit('access-form',{companyName:'Minha empresa',email:'user@example.test',password:'aB3!xY'}),'');
  const registration=app.calls.find(call=>call.url.endsWith('/fleet-access')&&JSON.parse(call.options.body).action==='register');assert.ok(registration);assert.equal(JSON.parse(registration.options.body).companyName,'Minha empresa');assert.equal(app.run('inviteTicket'),null);
  app.run("location.hash='#settings';render();");assert.match(app.get('#main').innerHTML,/Equipe e acesso/);
  assert.equal(await app.submit('invite-form',{email:'staff@example.test',role:'viewer'}),'');assert.match(app.get('#invite-result').innerHTML,/staff@example.test/);assert.match(app.get('#invite-result').innerHTML,/#activate=/);
});
