import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {initialState,period,saveClosing} from '../server/engine.js';
import {executeCommand} from '../server/commands.js';
import {createFleetApi} from '../server/api.js';

const raw=name=>fs.readFileSync(new URL('../frontend/'+name,import.meta.url),'utf8').replace(/^import .*?;\r?\n/gm,'').replace(/^export /gm,'');
const code=[raw('engine.js'),raw('reports.js'),raw('cloud-client.js'),"const CLOUD_CONFIG={url:'https://example.supabase.co',publishableKey:'public-test-key'};",raw('cloud-ui.js'),raw('app.js')].join('\n');
function domNode(){const classes=new Set();return {innerHTML:'',textContent:'',value:'',disabled:false,required:false,hidden:false,open:false,id:'',dataset:{},attributes:{},classList:{add:(...items)=>items.forEach(item=>classes.add(item)),remove:(...items)=>items.forEach(item=>classes.delete(item)),toggle:(item,enabled)=>enabled?classes.add(item):classes.delete(item),contains:item=>classes.has(item)},setAttribute(key,value){this.attributes[key]=value;},setCustomValidity(value){this.validationMessage=value;},addEventListener(){},scrollIntoView(){},focus(){},setSelectionRange(){},showModal(){this.open=true;},close(){this.open=false;},insertAdjacentHTML(position,html){this.innerHTML+=html;}};}
async function boot(role='admin',activation=false,storage=null,party='group'){
  const nodes=new Map(),handlers=new Map(),intervals=[],get=selector=>{if(!nodes.has(selector)){const node=domNode();node.querySelector=get;nodes.set(selector,node);}return nodes.get(selector);};
  const document={body:domNode(),visibilityState:'visible',querySelector:get,querySelectorAll:()=>[],addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);}};get('#modal').querySelector=get;
  let stored={state:initialState(),revision:0,company:{id:'company-one',name:'Empresa de teste'}};
  let account={role,party};const proofs=new Map();
  const repository={async load(){return structuredClone(stored);},async version(){return stored.revision;},async commit(company,revision,state){if(revision!==stored.revision)return null;stored={...stored,state:structuredClone(state),revision:revision+1};return structuredClone(stored);}};
  repository.verifyReceipt=async(actor,id,requestId)=>{const proof=proofs.get(id);if(!proof||proof.requestId!==requestId)throw Error('Comprovante inválido.');return proof;};
  repository.verifyFundingReceipt=async(actor,id,transferId)=>{const proof=proofs.get(id);if(!proof||proof.transferId!==transferId||proof.uploadedBy!==actor.userId)throw Error('Recibo inválido.');return proof;};
  const api=createFleetApi({repository,authenticate:async request=>request.headers.get('Authorization')?{userId:account.party==='carrier'?'carrier-test':'group-test',companyId:'company-one',email:'user@example.test',...account}:null});
  const calls=[];
  const fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/api/receipts')||url.endsWith('/api/funding-receipts')){const id=crypto.randomUUID(),proof={id,requestId:options.body.get('requestId'),transferId:options.body.get('transferId'),companyId:'company-one',uploadedBy:'carrier-test',name:options.body.get('file').name,mime:'application/pdf',size:options.body.get('file').size};proofs.set(id,proof);return Response.json(proof);}if(url.endsWith('/fleet-access')){const body=JSON.parse(options.body);return Response.json(body.action==='inspect'?{firstAccess:true,email:'',companyName:'Frota'}:{companyId:'company-one',role:'admin'});}if(url.includes('/auth/v1/token'))return Response.json({access_token:'fake-jwt',refresh_token:'fake-refresh',expires_in:3600});if(url.includes('/auth/v1/logout'))return Response.json({});if(url.endsWith('/api/team'))return Response.json({members:[]});if(url.endsWith('/api/team/invite'))return Response.json({email:'staff@example.test',role:'viewer',ticket:'b'.repeat(64)});return api(new Request(url,options));};
  class FormData {constructor(form){this.values=form?.data||new Map();}get(name){return this.values.get(name);}has(name){return this.values.has(name);}append(name,value){this.values.set(name,value);}}
  let printCount=0;
  const sandbox=vm.createContext({document,window:{addEventListener(){},scrollTo(){},print(){printCount++;}},location:{origin:'https://fleet.test',pathname:'/',hash:activation?'#activate='+'a'.repeat(64):'#overview'},sessionStorage:storage,localStorage:{getItem(){throw Error('Fleet records must not be stored in the browser');},setItem(){throw Error('Fleet records must not be stored in the browser');}},Intl,URL,Blob,Request,Response,FormData,crypto,structuredClone,fetch,setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{intervals.push(fn);return intervals.length;},console});
  vm.runInContext(code,sandbox,{timeout:1000});await new Promise(resolve=>setImmediate(resolve));
  const emit=async(type,event)=>{for(const handler of handlers.get(type)||[])await handler(event);};
  const submit=async(id,data,dataset={})=>{const error=domNode(),button=domNode(),form={id,dataset,data:new Map(Object.entries(data)),querySelector:selector=>selector==='[type="submit"]'?button:error};await emit('submit',{target:form,preventDefault(){}});return error.textContent;};
  const action=async(name,id='',extra={})=>emit('click',{target:{closest:()=>({disabled:false,dataset:{action:name,id,...extra}})}});
  return {get,submit,action,input:target=>emit('input',{target}),change:target=>emit('change',{target}),keydown:(target,key)=>emit('keydown',{target,key,preventDefault(){}}),calls,run:source=>vm.runInContext(source,sandbox),state:()=>structuredClone(stored),account:(party,role='operator')=>{account={party,role};},poll:async()=>{for(const fn of intervals)await fn();},printCount:()=>printCount,mutateState:fn=>{const state=structuredClone(stored.state);fn(state);stored={...stored,state,revision:stored.revision+1};}};
}
test('carrier receives new requests automatically without closing an open payment dialog',async()=>{
  const app=await boot('operator',false,null,'carrier');
  assert.equal(await app.submit('access-form',{email:'carrier@example.test',password:'test-password'}),'');
  const makeRequest=(id,plate)=>({id,period:period('2026-10',1),requestedAt:'2026-10-07T10:00:00.000Z',status:'pending',snapshot:{plate,driver:'Motorista',farmId:'farm1',farmName:'Fazenda 1',net:12000,paymentDetails:{method:'pix',holder:'Titular',document:'05556110190',pixKey:'05556110190'}},payment:null,paymentHistory:[]});
  app.mutateState(state=>state.paymentRequests.push(makeRequest('request-one','AAA1A11')));
  await app.poll();assert.match(app.get('#main').innerHTML,/AAA1A11/);assert.match(app.get('#toast').textContent,/Nova solicitação/);
  app.get('#modal').open=true;
  app.mutateState(state=>state.paymentRequests.push(makeRequest('request-two','BBB2B22')));
  await app.poll();assert.doesNotMatch(app.get('#main').innerHTML,/BBB2B22/);assert.equal(app.get('#modal').open,true);
  app.get('#modal').open=false;
  await app.poll();assert.match(app.get('#main').innerHTML,/BBB2B22/);
});
test('carrier payments are grouped and filtered by fortnight and invoice',async()=>{
  const app=await boot('operator',false,null,'carrier');assert.equal(await app.submit('access-form',{email:'carrier@example.test',password:'test-password'}),'');
  const make=(id,status,plate,net,closingId)=>({id,closingId,period:period('2026-10',1),requestedAt:'2026-10-07T10:00:00.000Z',status,snapshot:{plate,driver:'Motorista '+plate,farmId:'farm1',farmName:'Fazenda 1',net,gross:net,discount:0,payableDays:15,carrier:'Transportadora',paymentDetails:{method:'pix',holder:'Titular',document:'05556110190',pixKey:'05556110190'}},payment:status==='paid'?{date:'2026-10-15',receipt:{id:'proof-'+id,name:'pagamento.pdf'}}:null,paymentHistory:[],...(status==='cancelled'?{cancelledAt:'2026-10-08T10:00:00.000Z',cancelReason:'Solicitação refeita'}:{})});
  app.mutateState(state=>{state.closings.push({id:'invoice-1',period:period('2026-10',1),farmIds:['farm1'],closedDate:'2026-10-06',rows:[{farmId:'farm1',truckId:'req-pending'},{farmId:'farm1',truckId:'req-paid'}]},{id:'invoice-2',period:period('2026-10',1),farmIds:['farm1'],closedDate:'2026-10-08',rows:[{farmId:'farm1',truckId:'req-cancelled'}]});state.paymentRequests.push(make('req-pending','pending','AAA1A11',12000,'invoice-1'),make('req-paid','paid','BBB2B22',14000,'invoice-1'),make('req-cancelled','cancelled','CCC3C33',8000,'invoice-2'));});
  await app.poll();const html=app.get('#main').innerHTML;assert.match(html,/Aguardando pagamento/);assert.match(html,/Histórico de solicitações/);assert.match(html,/AAA1A11/);assert.match(html,/BBB2B22/);assert.match(html,/CCC3C33/);assert.match(html,/Pago em 15\/10\/2026/);assert.match(html,/Solicitação cancelada/);assert.match(html,/Total pago: R\$\s?14\.000,00/);assert.match(html,/Quinzena 01\/10\/2026 a 15\/10\/2026/);assert.match(html,/Fatura 1/);assert.match(html,/Fatura 2/);assert.match(html,/id="request-invoice"/);
  const invoice=app.get('#request-invoice');invoice.id='request-invoice';invoice.value='invoice-2';await app.change(invoice);const filtered=app.get('#main').innerHTML;assert.match(filtered,/CCC3C33/);assert.doesNotMatch(filtered,/AAA1A11|BBB2B22/);
  await app.action('request-detail','req-paid');const detail=app.get('#modal-content').innerHTML;assert.match(detail,/Abrir comprovante/);assert.doesNotMatch(detail,/Corrigir registro|correct-request/);
});test('fortnight history groups multiple farm invoices and unlocks a separate invoice for a late truck',async()=>{
  const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
  const seed=initialState();seed.trucks=[{id:'a',plate:'ABC1D23',driver:'Motorista A',carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''},{id:'b',plate:'DEF1G23',driver:'Motorista B',carrier:'Transportadora',farmId:'farm2',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''}];saveClosing(seed,period('2026-10',1),'farm1','f1','2026-10-06');saveClosing(seed,period('2026-10',1),'farm2','f2','2026-10-06');seed.trucks.push({...seed.trucks[0],id:'late',plate:'XYZ9B87',start:'2026-10-08'});saveClosing(seed,period('2026-10',2),'farm1','f3','2026-10-20');app.mutateState(state=>Object.assign(state,seed));await app.poll();app.run(`currentMonth='2026-10';currentHalf=1;location.hash='#closings';render()`);
  let html=app.get('#main').innerHTML;assert.equal((html.match(/class="card fortnight-history"/g)||[]).length,1);assert.equal((html.match(/<strong>Fatura 1<\/strong>/g)||[]).length,2);assert.doesNotMatch(html,/<strong>Fatura 2<\/strong>/);assert.match(html,/Emitir fatura complementar/);assert.match(html,/Faturas da quinzena selecionada/);assert.doesNotMatch(html,/16\/10\/2026 a 31\/10\/2026/);
  await app.action('history-details','f1');assert.match(app.get('#modal-content').innerHTML,/Início: 01\/10\/2026/);
  await app.action('complementary-invoice','',{month:'2026-10',half:'1'});app.get('#complementary-farm').value='farm1';app.run('updateComplementaryInvoicePreview()');const preview=app.get('#complementary-preview').innerHTML;assert.match(app.get('#modal-content').innerHTML,/Emitir fatura complementar/);assert.match(preview,/XYZ9B87/);assert.match(preview,/somente estas placas/i);
  await app.action('confirm-complementary-invoice');const saved=app.state().state;assert.equal(saved.closings.length,4);assert.equal(saved.closings[3].rows.length,1);assert.equal(saved.closings[3].rows[0].truckId,'late');assert.equal(saved.closings[0].rows[0].truckId,'a');assert.equal(saved.closings[1].rows[0].truckId,'b');assert.equal(saved.invoiceReopens.length,0);assert.match(app.get('#main').innerHTML,/<strong>Fatura 2<\/strong>/);
  await app.action('half','',{half:'2'});html=app.get('#main').innerHTML;assert.match(html,/16\/10\/2026 a 31\/10\/2026/);assert.doesNotMatch(html,/01\/10\/2026 a 15\/10\/2026/);
});
test('carrier can select plates sharing a Pix key and preview their joint transfer total',async()=>{
  const app=await boot('operator',false,null,'carrier');assert.equal(await app.submit('access-form',{email:'carrier@example.test',password:'carrier-password'}),'');
  const seed=initialState(),details={method:'pix',holder:'Titular do Pix',document:'12345678901',pixKey:'chave-compartilhada@example.com'};seed.trucks=[0,1].map(index=>({id:'shared-'+index,plate:'ABC1D2'+index,driver:'Motorista '+index,carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentDetails:details}));saveClosing(seed,period('2026-10',1),'farm1','shared-invoice','2026-10-06');
  const group={userId:'group-user',email:'group@example.test',role:'admin',party:'group',companyId:'company-one'},requested=executeCommand(seed,{type:'payment.request',payload:{month:'2026-10',half:1,farmId:'farm1'}},group).state;app.mutateState(state=>Object.assign(state,requested));await app.poll();
  let html=app.get('#main').innerHTML;assert.match(html,/Conta compartilhada/);assert.match(html,/chave-compartilhada@example\.com/);assert.match(html,/Marque as placas que foram pagas juntas/);
  const ids=app.state().state.paymentRequests.map(request=>request.id);for(const id of ids)await app.change({matches:selector=>selector==='[data-payment-group-request]',dataset:{paymentGroupRequest:id},checked:true});
  html=app.get('#main').innerHTML;assert.match(html,/2 selecionada\(s\) · R\$\s?30\.000,00/);const key=app.run('paymentGroupKey(portalRequests[0])');await app.action('pay-group','',{group:encodeURIComponent(key)});
  const modal=app.get('#modal-content').innerHTML;assert.match(modal,/Registrar pagamento conjunto/);assert.match(modal,/ABC1D20/);assert.match(modal,/ABC1D21/);assert.match(modal,/Total do pagamento conjunto/);assert.match(modal,/R\$\s?30\.000,00/);assert.match(modal,/Um comprovante será compartilhado/);
});
test('opening closings automatically separates a legacy invoice that mixed farms',async()=>{
  const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
  const seed=initialState();seed.trucks=[{id:'farm-a',plate:'ABC1D23',driver:'Motorista A',carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''},{id:'farm-b',plate:'DEF1G23',driver:'Motorista B',carrier:'Transportadora',farmId:'farm2',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''}];
  app.mutateState(state=>{Object.assign(state,seed);const closing=saveClosing(state,period('2026-10',1),'','legacy-mixed','2026-10-06');closing.rows[0].paid={date:'2026-10-06',note:'Pagamento preservado'};});await app.poll();
  app.run("currentMonth='2026-10';currentHalf=1;location.hash='#closings';render()");await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  const saved=app.state().state;assert.equal(saved.closings.length,2);assert.ok(saved.closings.every(closing=>closing.farmIds.length===1&&closing.rows.every(row=>row.farmId===closing.farmIds[0])));assert.ok(saved.closings.some(closing=>closing.rows.some(row=>row.paid?.note==='Pagamento preservado')));
});
test('second fortnight reminds about a truck started in the first and links to its pending invoice',async()=>{
  const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
  const seed=initialState();seed.trucks=[{id:'oct8',plate:'ABC1D23',driver:'Motorista',carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:40000,start:'2026-10-08',end:''}];
  app.mutateState(state=>Object.assign(state,seed));await app.poll();app.run("currentMonth='2026-10';currentHalf=2;farmFilter='';location.hash='#closings';render()");
  let html=app.get('#main').innerHTML;assert.match(html,/começaram na 1ª quinzena e ainda não foram faturados nela/);assert.match(html,/data-action="view-period" data-month="2026-10" data-half="1"/);
  await app.action('view-period','',{month:'2026-10',half:1});html=app.get('#main').innerHTML;assert.match(html,/01\/10\/2026 a 15\/10\/2026/);assert.match(html,/ABC1D23/);
});
test('payment details display CPF and CNPJ with punctuation',async()=>{
  const app=await boot();
  assert.equal(app.run("formatPaymentDocument('05556110190')"),'055.561.101-90');
  assert.equal(app.run("formatPaymentDocument('12345678000199')"),'12.345.678/0001-99');
  assert.match(app.run("paymentDetailsMarkup({method:'pix',holder:'Titular',document:'05556110190',pixKey:'05556110190'})"),/CPF\/CNPJ: <strong>055\.561\.101-90<\/strong>/);
});
test('CT-e print uses the selected farm, visible columns and applied column filters',async()=>{
  const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
  app.run("cteDocuments=[{id:'cte-one',farmId:'farm1',farmName:'Fazenda 1',number:'5219',plate:'ABC1234',issuedOn:'2026-10-08',totalValue:100,shipper:'Remetente A'},{id:'cte-two',farmId:'farm1',farmName:'Fazenda 1',number:'5181',plate:'DEF5678',issuedOn:'2026-10-09',totalValue:200,shipper:'Remetente B'}];cteFarms=[{id:'farm1',name:'Fazenda 1'}];ctePreferences={visibleColumns:['number','plate'],columnOrder:['number','plate']};cteFarmFilter='farm1';cteColumnFilters={plate:['ABC1234']};main.innerHTML=ctesView()");
  const html=app.get('#main').innerHTML;assert.match(html,/Imprimir \/ Salvar PDF/);assert.match(html,/Fazenda: Fazenda 1 · 1 documento\(s\)/);assert.match(html,/ABC1234/);assert.doesNotMatch(html,/DEF5678|Remetente A/);
  const css=fs.readFileSync(new URL('../frontend/styles.css',import.meta.url),'utf8');assert.match(css,/main:has\(\.cte-report-card\)>:not\(\.cte-report-card\)\{display:none!important\}/);assert.match(css,/@page cte-report\{size:A4 landscape;margin:0\}/);
  await app.action('cte-print');assert.equal(app.printCount(),1);
});
test('CPF and CNPJ share one CT-e report field per participant without losing saved preferences',async()=>{
  const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
  const parties=['shipper','recipient','serviceTaker','issuer'],oldColumns=parties.flatMap(party=>[party+'Cnpj',party+'Cpf']),mergedColumns=parties.map(party=>party+'Document');
  const prior=JSON.stringify({visibleColumns:oldColumns,columnOrder:[...oldColumns,'plate']}),saved=JSON.parse(app.run(`JSON.stringify(normalizeCtePreferences(JSON.parse(${JSON.stringify(prior)})))`));
  assert.deepEqual(saved.visibleColumns,mergedColumns);assert.deepEqual(saved.columnOrder.slice(0,4),mergedColumns);assert.equal(saved.columnOrder.length,app.run('ALL_CTE_COLUMNS.length'));
  assert.equal(app.run("CTE_FILTER_FIELDS.shipperDocument.get({participantDetails:{shipper:{cnpj:'06338525000118',cpf:''}}})"),'06.338.525/0001-18');
  assert.equal(app.run("CTE_FILTER_FIELDS.recipientDocument.get({participantDetails:{recipient:{cnpj:'',cpf:'12345678901'}}})"),'123.456.789-01');
  app.run(`ctePreferences=JSON.parse(${JSON.stringify(JSON.stringify(saved))});ctePreferencesForm()`);const html=app.get('#modal-content').innerHTML;assert.equal((html.match(/<span>CPF\/CNPJ d[oa] [^<]+<\/span>/g)||[]).length,4);const checkboxFields=[...html.matchAll(/data-cte-pref-column="([^"]+)"/g)].map(match=>match[1]);assert.deepEqual(checkboxFields.filter(field=>field.endsWith('Document')),mergedColumns);assert.equal(checkboxFields.filter(field=>/(?:Cnpj|Cpf)$/.test(field)).length,0);
});
test('CT-e report offers all manifested invoice numbers in one customizable column',async()=>{
  const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
  app.run("cteDocuments=[{id:'cte-notes',farmId:'farm1',farmName:'Fazenda 1',number:'5079',plate:'BCD5C56',issuedOn:'2026-09-22',totalValue:46875.32,manifestedNotes:['857','858']}];cteFarms=[{id:'farm1',name:'Fazenda 1'}];ctePreferences={visibleColumns:['manifestedNotes'],columnOrder:['manifestedNotes']};main.innerHTML=ctesView()");
  assert.match(app.get('#main').innerHTML,/NOTAS FISCAIS MANIFESTADAS/);assert.match(app.get('#main').innerHTML,/857, 858/);
  app.run('ctePreferencesForm()');assert.match(app.get('#modal-content').innerHTML,/Notas fiscais manifestadas/);assert.match(app.get('#modal-content').innerHTML,/data-cte-pref-column="manifestedNotes"/);
});
test('basic workflow hides the farm-to-carrier receipt panel and receipt settings',async()=>{
  const app=await boot();assert.equal(await app.submit('access-form',{email:'group@example.test',password:'sixchars'}),'');
  app.run("location.hash='#settings';render()");assert.doesNotMatch(app.get('#main').innerHTML,/Dados do recibo padrão/);
  await app.action('cloud-logout');app.account('carrier');assert.equal(await app.submit('access-form',{email:'carrier@example.test',password:'sixchars'}),'');
  assert.match(app.get('#main').innerHTML,/Pagamentos da transportadora/);assert.doesNotMatch(app.get('#main').innerHTML,/Repasses da fazenda|Gerar recibo padrão|Anexar recibo assinado/);
});test('CPF and CNPJ are masked as entered or pasted, with editable separators',async()=>{
  const app=await boot();
  const field={id:'truck-payment-document',value:'0555',selectionStart:4,selectionEnd:4,setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};
  await app.input(field);assert.equal(field.value,'055.5');assert.equal(field.selectionStart,5);
  field.value='05556110190';field.selectionStart=11;field.selectionEnd=11;
  await app.input(field);assert.equal(field.value,'055.561.101-90');assert.equal(field.selectionStart,14);
  field.selectionStart=4;field.selectionEnd=4;
  await app.keydown(field,'Backspace');assert.equal(field.value,'055.611.019-0');assert.equal(field.selectionStart,2);
  field.value='12345678000199';field.selectionStart=14;field.selectionEnd=14;
  await app.input(field);assert.equal(field.value,'12.345.678/0001-99');assert.equal(field.selectionStart,18);
  field.value='123456780001991234';field.selectionStart=18;field.selectionEnd=18;
  await app.input(field);assert.equal(field.value,'12.345.678/0001-99');
});
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

