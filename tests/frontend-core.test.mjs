import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {initialState,period,saveClosing,transferTruck} from '../server/engine.js';
import {executeCommand} from '../server/commands.js';
import {createFleetApi} from '../server/api.js';

const raw=name=>fs.readFileSync(new URL('../frontend/'+name,import.meta.url),'utf8').replace(/^import .*?;\r?\n/gm,'').replace(/^export /gm,'');
const code=[raw('engine.js'),raw('reports.js'),raw('cloud-client.js'),"const CLOUD_CONFIG={url:'https://example.supabase.co',publishableKey:'public-test-key'};const APP_ENVIRONMENT='production';const TEST_ACCESS_EMAIL='andersondanrlei33@gmail.com';",raw('cloud-ui.js'),raw('app.js')].join('\n');
function domNode(){const classes=new Set();return {innerHTML:'',textContent:'',value:'',disabled:false,required:false,hidden:false,open:false,id:'',dataset:{},attributes:{},classList:{add:(...items)=>items.forEach(item=>classes.add(item)),remove:(...items)=>items.forEach(item=>classes.delete(item)),toggle:(item,enabled)=>enabled?classes.add(item):classes.delete(item),contains:item=>classes.has(item)},setAttribute(key,value){this.attributes[key]=value;},setCustomValidity(value){this.validationMessage=value;},addEventListener(){},scrollIntoView(){},focus(){},setSelectionRange(){},showModal(){this.open=true;},close(){this.open=false;},insertAdjacentHTML(position,html){this.innerHTML+=html;}};}
async function boot(role='admin',activation=false,storage=null,party='group',teamFixture=[]){
  const nodes=new Map(),handlers=new Map(),intervals=[],get=selector=>{if(!nodes.has(selector)){const node=domNode();node.querySelector=get;nodes.set(selector,node);}return nodes.get(selector);};
  const document={body:domNode(),visibilityState:'visible',querySelector:get,querySelectorAll:()=>[],addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);}};get('#modal').querySelector=get;
  let stored={state:initialState(),revision:0,company:{id:'company-one',name:'Empresa de teste'}};
  let account={role,party};const proofs=new Map();
  const repository={async load(){return structuredClone(stored);},async version(){return stored.revision;},async commit(company,revision,state){if(revision!==stored.revision)return null;stored={...stored,state:structuredClone(state),revision:revision+1};return structuredClone(stored);}};
  repository.hasTruckFiscalActivity=async()=>false;
  repository.verifyReceipt=async(actor,id,requestId)=>{const proof=proofs.get(id);if(!proof||proof.requestId!==requestId)throw Error('Comprovante inválido.');return proof;};
  repository.verifyFundingReceipt=async(actor,id,transferId)=>{const proof=proofs.get(id);if(!proof||proof.transferId!==transferId||proof.uploadedBy!==actor.userId)throw Error('Recibo inválido.');return proof;};
  const api=createFleetApi({repository,authenticate:async request=>request.headers.get('Authorization')?{userId:account.party==='carrier'?'carrier-test':'group-test',companyId:'company-one',email:'user@example.test',...account}:null});
  const calls=[];
  const fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/api/receipts')||url.endsWith('/api/funding-receipts')){const id=crypto.randomUUID(),proof={id,requestId:options.body.get('requestId'),transferId:options.body.get('transferId'),companyId:'company-one',uploadedBy:'carrier-test',name:options.body.get('file').name,mime:'application/pdf',size:options.body.get('file').size};proofs.set(id,proof);return Response.json(proof);}if(url.endsWith('/fleet-access')){const body=JSON.parse(options.body);return Response.json(body.action==='inspect'?{firstAccess:true,email:'',companyName:'Frota'}:{companyId:'company-one',role:'admin'});}if(url.includes('/auth/v1/token'))return Response.json({access_token:'fake-jwt',refresh_token:'fake-refresh',expires_in:3600});if(url.includes('/auth/v1/logout'))return Response.json({});if(url.endsWith('/api/team'))return Response.json({members:teamFixture});if(url.endsWith('/api/team/invite'))return Response.json({email:'staff@example.test',role:'viewer',ticket:'b'.repeat(64)});return api(new Request(url,options));};
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
  const makeRequest=(id,plate)=>({id,closingId:'invoice-shared',period:period('2026-10',1),requestedAt:'2026-10-07T10:00:00.000Z',status:'pending',snapshot:{plate,driver:'Motorista',farmId:'farm1',farmName:'Fazenda 1',net:12000,paymentDetails:{method:'pix',holder:'Titular',document:'05556110190',pixKey:'05556110190'}},payment:null,paymentHistory:[]});
  app.mutateState(state=>state.paymentRequests.push(makeRequest('request-one','AAA1A11')));
  await app.poll();assert.match(app.get('#main').innerHTML,/1 placa\(s\)/);assert.doesNotMatch(app.get('#main').innerHTML,/AAA1A11/);assert.match(app.get('#toast').textContent,/Nova solicitação/);
  let group=app.run('encodeURIComponent(paymentGroupKey(portalRequests[0]))');await app.action('request-account-detail','',{group});assert.match(app.get('#modal-content').innerHTML,/AAA1A11/);
  app.get('#modal').open=true;
  app.mutateState(state=>state.paymentRequests.push(makeRequest('request-two','BBB2B22')));
  await app.poll();assert.doesNotMatch(app.get('#modal-content').innerHTML,/BBB2B22/);assert.equal(app.get('#modal').open,true);
  app.get('#modal').open=false;
  await app.poll();assert.match(app.get('#main').innerHTML,/2 placa\(s\)/);assert.doesNotMatch(app.get('#main').innerHTML,/BBB2B22/);
  group=app.run('encodeURIComponent(paymentGroupKey(portalRequests[0]))');await app.action('request-account-detail','',{group});assert.match(app.get('#modal-content').innerHTML,/AAA1A11/);assert.match(app.get('#modal-content').innerHTML,/BBB2B22/);
});
test('farms pending CT-e metric opens a manager list with plate, farm, notes and waiting time',async()=>{
 const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'test-password'}),'');
 const accessKey='1'.repeat(25)+'000001234'+'1'.repeat(10);
 app.run(`cteSummaryLoaded=true;cteRequests=[{id:'cte-pending',status:'pending',plate:'BCD5C56',driver:'Motorista Teste',farmName:'Fazenda Mafra',requestedAt:new Date().toISOString(),requestedEmail:'funcionario@example.test',invoiceKeys:['${accessKey}'],invoiceFiles:[],note:'Prioridade'}];main.innerHTML=farmsView()`);
 assert.match(app.get('#main').innerHTML,/data-action="farm-pending-ctes"/);await app.action('farm-pending-ctes');
 const details=app.get('#modal-content').innerHTML;assert.match(details,/BCD5C56/);assert.match(details,/Fazenda Mafra/);assert.match(details,/NF-e 1234/);assert.match(details,/funcionario@example\.test/);assert.match(details,/Prioridade/);assert.match(details,/Menos de 1 min/);
});
test('received CT-e report shows elapsed time from request to uploaded document, including saved column preferences',async()=>{
 const app=await boot();
 app.run(`window.innerWidth=1280;cteRequests=[{id:'request-time',documentId:'document-time',status:'issued',requestedAt:'2026-10-23T08:00:00.000Z',updatedAt:'2026-10-23T10:35:00.000Z'}];cteDocuments=[{id:'document-time',requestId:'request-time',uploadedAt:'2026-10-23T10:35:00.000Z',number:'CTE-123',issuedOn:'2026-10-23',plate:'ABC1D23',driver:'Motorista',farmName:'Fazenda Mafra',shipper:'Remetente',recipient:'Destinatário',serviceTaker:'Tomador',issuer:'Transportadora',totalValue:100,cargoWeight:1000,cargoWeightUnit:'kg'}];ctePreferences=normalizeCtePreferences({visibleColumns:['number'],columnOrder:['number']});main.innerHTML=ctesView()`);
 const html=app.get('#main').innerHTML;
 assert.match(html,/TEMPO ATÉ RECEBER/);
 assert.match(html,/2h 35min/);
});
test('farm team settings use compact selectable tabs and prefill a farm-specific invite',async()=>{
 const fixture=[{user_id:'staff-1',email:'staff@example.test',party:'farm',farm_id:'farm2',role:'operator',active:true}];
 const app=await boot('admin',false,null,'group',fixture);assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
 app.run("location.hash='#settings';render()");await app.poll();let html=app.get('#team-list').innerHTML;
 assert.match(html,/team-farm-tabs/);assert.match(html,/Fazenda 1/);assert.match(html,/Fazenda 2/);assert.match(html,/aria-pressed="true" data-action="team-farm-select" data-farm-id="farm1"/);assert.doesNotMatch(html,/Fazenda 3[\s\S]*Fazenda 4[\s\S]*Fazenda sem vínculo/);
 await app.action('team-farm-select','',{farmId:'farm2'});html=app.get('#team-farm-panel').innerHTML;assert.match(html,/staff@example\.test/);assert.match(html,/Cadastrar usuário/);assert.doesNotMatch(html,/Nenhum funcionário com acesso/);
 await app.action('team-invite-farm','',{farmId:'farm2'});assert.equal(app.get('#invite-profile').value,'farm:operator');assert.equal(app.get('#invite-farm').value,'farm2');assert.equal(app.get('#invite-farm').required,true);assert.equal(app.get('#invite-farm-field').hidden,false);
});
test('carrier payments are grouped and filtered by fortnight and invoice',async()=>{
  const app=await boot('operator',false,null,'carrier');assert.equal(await app.submit('access-form',{email:'carrier@example.test',password:'test-password'}),'');
  const make=(id,status,plate,net,closingId)=>({id,closingId,period:period('2026-10',1),requestedAt:'2026-10-07T10:00:00.000Z',status,snapshot:{plate,driver:'Motorista '+plate,farmId:'farm1',farmName:'Fazenda 1',net,gross:net,discount:0,payableDays:15,carrier:'Transportadora',paymentDetails:{method:'pix',holder:'Titular',document:'05556110190',pixKey:'05556110190'}},payment:status==='paid'?{date:'2026-10-15',receipt:{id:'proof-'+id,name:'pagamento.pdf'}}:null,paymentHistory:[],...(status==='cancelled'?{cancelledAt:'2026-10-08T10:00:00.000Z',cancelReason:'Solicitação refeita'}:{})});
  app.mutateState(state=>{state.closings.push({id:'invoice-1',period:period('2026-10',1),farmIds:['farm1'],closedDate:'2026-10-06',rows:[{farmId:'farm1',truckId:'req-pending'},{farmId:'farm1',truckId:'req-paid'}]},{id:'invoice-2',period:period('2026-10',1),farmIds:['farm1'],closedDate:'2026-10-08',rows:[{farmId:'farm1',truckId:'req-cancelled'}]});state.paymentRequests.push(make('req-pending','pending','AAA1A11',12000,'invoice-1'),make('req-paid','paid','BBB2B22',14000,'invoice-1'),make('req-cancelled','cancelled','CCC3C33',8000,'invoice-2'));});
  await app.poll();let html=app.get('#main').innerHTML;assert.match(html,/Aguardando pagamento/);assert.match(html,/Histórico de pagamentos/);assert.doesNotMatch(html,/AAA1A11/);assert.match(html,/BBB2B22/);assert.match(html,/CCC3C33/);assert.match(html,/Pago em 15\/10\/2026/);assert.match(html,/Solicitação cancelada/);assert.match(html,/Total pago: R\$\s?14\.000,00/);assert.match(html,/Quinzena 01\/10\/2026 a 15\/10\/2026/);assert.match(html,/Fatura 1/);assert.match(html,/Fatura 2/);assert.match(html,/id="request-invoice"/);
  const pendingGroup=app.run('encodeURIComponent(paymentGroupKey(portalRequests.find(request=>request.id===\'req-pending\')))');await app.action('request-account-detail','',{group:pendingGroup});assert.match(app.get('#modal-content').innerHTML,/AAA1A11/);app.get('#modal').open=false;
  const invoice=app.get('#request-invoice');invoice.id='request-invoice';invoice.value='invoice-2';await app.change(invoice);const filtered=app.get('#main').innerHTML;assert.match(filtered,/CCC3C33/);assert.doesNotMatch(filtered,/AAA1A11|BBB2B22/);
  await app.action('request-detail','req-paid');const detail=app.get('#modal-content').innerHTML;assert.match(detail,/Abrir comprovante/);assert.doesNotMatch(detail,/Corrigir registro|correct-request/);
});
test('carrier sees one payment per shared account with plate values expandable in details',async()=>{
 const app=await boot('operator',false,null,'carrier');assert.equal(await app.submit('access-form',{email:'carrier@example.test',password:'test-password'}),'');
 const details={method:'pix',holder:'Titular do Pix',document:'12345678901',pixKey:'pix@example.com'},state=initialState();state.paymentAccounts=[{id:'pix-account',farmId:'farm1',name:'Conta do João',details}];state.trucks=[0,1].map(index=>({id:'truck-'+index,plate:'ABC1D2'+index,driver:'Motorista '+index,carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentAccountId:'pix-account',paymentDetails:details}));saveClosing(state,period('2026-10',1),'farm1','invoice-account','2026-10-06');
 const group={userId:'group-user',email:'group@example.test',role:'admin',party:'group',companyId:'company-one'},requested=executeCommand(state,{type:'payment.request',payload:{month:'2026-10',half:1,farmId:'farm1'}},group).state;app.mutateState(saved=>Object.assign(saved,requested));await app.poll();
 let html=app.get('#main').innerHTML;assert.match(html,/Conta do João/);assert.match(html,/2 placa\(s\)/);assert.match(html,/data-action="request-account-detail"/);assert.doesNotMatch(html,/ABC1D20|ABC1D21|data-payment-group-request/);
 const key=app.run('paymentGroupKey(portalRequests[0])');await app.action('request-account-detail','',{group:encodeURIComponent(key)});const form=app.get('#modal-content').innerHTML;assert.match(form,/Registrar pagamento desta conta/);assert.match(form,/pix@example\.com/);assert.match(form,/ABC1D20/);assert.match(form,/ABC1D21/);assert.match(form,/Valor desta conta/);
});
test('group can follow payment requests but cannot register a payment',async()=>{
 const app=await boot('operator');assert.equal(await app.submit('access-form',{email:'group@example.test',password:'test-password'}),'');
 const details={method:'pix',holder:'Titular do Pix',document:'12345678901',pixKey:'pix@example.com'},state=initialState();state.paymentAccounts=[{id:'pix-account',farmId:'farm1',name:'Conta do João',details}];state.trucks=[{id:'truck-1',plate:'ABC1D20',driver:'Motorista',carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentAccountId:'pix-account',paymentDetails:details}];saveClosing(state,period('2026-10',1),'farm1','invoice-account','2026-10-06');
 const actor={userId:'group-user',email:'group@example.test',role:'operator',party:'group',companyId:'company-one'},requested=executeCommand(state,{type:'payment.request',payload:{month:'2026-10',half:1,farmId:'farm1'}},actor).state;app.mutateState(saved=>Object.assign(saved,requested));await app.poll();app.run("location.hash='#requests';render()");
 const html=app.get('#main').innerHTML;assert.match(html,/Conta do João/);assert.match(html,/Aguardando pagamento/);assert.doesNotMatch(html,/data-action="pay-group"|Registrar pagamento/);
 const key=app.run('paymentGroupKey(portalRequests[0])');await app.action('pay-group','',{group:encodeURIComponent(key)});assert.equal(app.get('#modal').open,false);assert.match(app.get('#toast').textContent,/Acesse como transportadora/);
});
test('transportadora envia CT-e somente pela solicitação com placa e fazenda definidas',async()=>{
 const app=await boot('operator',false,null,'carrier');assert.equal(await app.submit('access-form',{email:'carrier@example.test',password:'test-password'}),'');
 app.run("view='ctes';cteSummaryLoaded=true;render()");const html=app.get('#main').innerHTML;
 assert.doesNotMatch(html,/data-action="cte-upload"|Enviar primeiro CT-e/);
 await app.action('cte-upload');assert.equal(app.get('#modal').open,false);
 app.run("cteRequests=[{id:'request-one',status:'pending',farmName:'Fazenda Veneza',plate:'ATV2C70',requestedEmail:'funcionario@example.test',invoiceKeys:[]}];cteUploadForm('request-one')");
 assert.match(app.get('#modal-content').innerHTML,/Fazenda Veneza · ATV2C70/);
 app.run("cteRequests=[{id:'request-correction',status:'pending',farmName:'Fazenda Sossego',plate:'ATV2C70',invoiceKeys:['chave'],invoiceFiles:[{name:'CARTA-CORRECAO-MINUTA-PLACA-ATV2C70.pdf',documentType:'correction'}]}];cteUploadForm('request-correction')");
 const correctionModal=app.get('#modal-content').innerHTML;assert.match(correctionModal,/carta de correção anexada/i);assert.match(correctionModal,/confirmPlateCorrection/);assert.match(correctionModal,/vinculado à placa ATV2C70/);
 assert.throws(()=>app.run("cteUploadForm()"),/solicitação pendente da fazenda/);
});
test('payment history shows each joint transfer once and opens its plates, amounts and receipt',async()=>{
 const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
 const detailsA={method:'pix',holder:'Titular A',document:'12345678901',pixKey:'conta-a@example.com'},detailsB={method:'pix',holder:'Titular B',document:'12345678901',pixKey:'conta-b@example.com'},state=initialState();
 state.paymentAccounts=[{id:'account-a',name:'Conta A',details:detailsA},{id:'account-b',name:'Conta B',details:detailsB}];state.trucks=[0,1,2,3].map(index=>({id:'truck-'+index,plate:'ABC1D2'+index,driver:'Motorista '+index,carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentAccountId:index<2?'account-a':'account-b',paymentDetails:index<2?detailsA:detailsB}));saveClosing(state,period('2026-10',1),'farm1','invoice-joint','2026-10-06');
 const group={userId:'group-test',email:'user@example.test',role:'admin',party:'group',companyId:'company-one'},carrier={userId:'carrier-test',email:'carrier@example.test',role:'operator',party:'carrier',companyId:'company-one'};let paid=executeCommand(state,{type:'payment.request',payload:{month:'2026-10',half:1,farmId:'farm1'}},group).state;
 for(const accountId of ['account-a','account-b']){const requests=paid.paymentRequests.filter(request=>request.snapshot.paymentAccountId===accountId),first=requests[0],proof={id:'receipt-'+accountId,requestId:first.id,companyId:'company-one',uploadedBy:'carrier-test',name:accountId+'.pdf',mime:'application/pdf',size:100};paid=executeCommand(paid,{type:'payment.record-batch',payload:{requestIds:requests.map(request=>request.id),date:'2026-10-09',receiptId:proof.id}},carrier,{receipt:proof}).state;}
 app.mutateState(saved=>Object.assign(saved,paid));await app.poll();app.run("location.hash='#requests';render()");const html=app.get('#main').innerHTML;
 assert.match(html,/Histórico de pagamentos/);assert.equal((html.match(/data-action="payment-group-detail"/g)||[]).length,2);assert.equal((html.match(/data-action="receipt-view"/g)||[]).length,2);assert.match(html,/Conta A/);assert.match(html,/Conta B/);assert.match(html,/2 pagamento\(s\) · 0 solicitação\(ões\) cancelada\(s\)/);
 const firstGroup=paid.paymentRequests[0].payment.paymentGroupId;await app.action('payment-group-detail','transfer:'+firstGroup);const detail=app.get('#modal-content').innerHTML;assert.match(detail,/Placas deste pagamento/);assert.match(detail,/ABC1D20/);assert.match(detail,/ABC1D21/);assert.match(detail,/TOTAL DA TRANSFERÊNCIA/);assert.match(detail,/Abrir comprovante/);assert.doesNotMatch(detail,/ABC1D22|ABC1D23/);
});
test('payment account editor shows unlinked and current-account plates but hides plates linked elsewhere',async()=>{
 const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
 const details={method:'pix',holder:'Titular',document:'12345678901',pixKey:'pix@example.com'},seed=initialState();seed.paymentAccounts=[{id:'pix-account',farmId:'farm1',name:'Conta compartilhada',details},{id:'other-account',name:'Outra conta',details:{...details,pixKey:'other@example.com'}}];seed.trucks=[{id:'a',plate:'ABC1D23',driver:'Motorista A',carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentAccountId:'pix-account',paymentDetails:details},{id:'b',plate:'DEF1G23',driver:'Motorista B',carrier:'Transportadora',farmId:'farm2',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentAccountId:'pix-account',paymentDetails:details},{id:'c',plate:'GHI1J23',driver:'Motorista C',carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentAccountId:'other-account',paymentDetails:details},{id:'d',plate:'JKL4M56',driver:'Motorista D',carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''}];
 app.mutateState(state=>Object.assign(state,seed));await app.poll();await app.action('payment-accounts');await app.action('edit-payment-account','pix-account');
 const html=app.get('#modal-content').innerHTML;assert.doesNotMatch(html,/payment-account-farm|name="farmId"|Fazenda \*/);assert.match(html,/ABC1D23/);assert.match(html,/DEF1G23/);assert.match(html,/Fazenda 1/);assert.match(html,/Fazenda 2/);assert.match(html,/JKL4M56/);assert.doesNotMatch(html,/GHI1J23/);assert.match(html,/desmarque-a e salve/);
});
test('fortnight history groups multiple farm invoices and unlocks a separate invoice for a late truck',async()=>{
  const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
  const seed=initialState();seed.trucks=[{id:'a',plate:'ABC1D23',driver:'Motorista A',carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''},{id:'b',plate:'DEF1G23',driver:'Motorista B',carrier:'Transportadora',farmId:'farm2',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''}];saveClosing(seed,period('2026-10',1),'farm1','f1','2026-10-06');saveClosing(seed,period('2026-10',1),'farm2','f2','2026-10-06');seed.trucks.push({...seed.trucks[0],id:'late',plate:'XYZ9B87',start:'2026-10-08'});saveClosing(seed,period('2026-10',2),'farm1','f3','2026-10-20');app.mutateState(state=>Object.assign(state,seed));await app.poll();app.run(`currentMonth='2026-10';currentHalf=1;location.hash='#closings';render()`);
  let html=app.get('#main').innerHTML;assert.equal((html.match(/class="card fortnight-history"/g)||[]).length,1);assert.match(html,/<strong>Fatura 1<\/strong>/);assert.match(html,/<strong>Fatura 2<\/strong>/);assert.doesNotMatch(html,/<strong>Fatura 3<\/strong>/);assert.match(html,/Emitir fatura complementar/);assert.match(html,/Faturas da quinzena selecionada/);assert.doesNotMatch(html,/16\/10\/2026 a 31\/10\/2026/);
  app.run("farmFilter='farm1';render()");html=app.get('#main').innerHTML;assert.equal((html.match(/class="card fortnight-history"/g)||[]).length,1);assert.equal((html.match(/class="invoice-row"/g)||[]).length,1);const filteredHistory=html.slice(html.indexOf('Faturas da quinzena selecionada'));assert.match(filteredHistory,/Fazenda 1/);assert.doesNotMatch(filteredHistory,/Fazenda 2|Fatura 2/);app.run("farmFilter='';render()");
  await app.action('history-details','f1');const invoiceDetails=app.get('#modal-content').innerHTML;assert.match(invoiceDetails,/Início: 01\/10\/2026/);assert.match(invoiceDetails,/Mensal: R\$./);assert.match(invoiceDetails,/30\.000,00/);assert.match(invoiceDetails,/Tipo: Caçamba/);assert.match(invoiceDetails,/Eixos: 9 eixos/);assert.match(invoiceDetails,/data-action="invoice-print"/);await app.action('invoice-print');assert.equal(app.printCount(),1);assert.equal(app.get('body').classList.contains('invoice-print-open'),false);
  await app.action('complementary-invoice','',{month:'2026-10',half:'1'});app.get('#complementary-farm').value='farm1';app.run('updateComplementaryInvoicePreview()');const preview=app.get('#complementary-preview').innerHTML;assert.match(app.get('#modal-content').innerHTML,/Emitir fatura complementar/);assert.match(preview,/XYZ9B87/);assert.match(preview,/somente estas placas/i);
  await app.action('confirm-complementary-invoice');const saved=app.state().state;assert.equal(saved.closings.length,4);assert.equal(saved.closings[3].rows.length,1);assert.equal(saved.closings[3].rows[0].truckId,'late');assert.equal(saved.closings[0].rows[0].truckId,'a');assert.equal(saved.closings[1].rows[0].truckId,'b');assert.equal(saved.invoiceReopens.length,0);assert.match(app.get('#main').innerHTML,/<strong>Fatura 4<\/strong>/);
  await app.action('half','',{half:'2'});html=app.get('#main').innerHTML;assert.match(html,/16\/10\/2026 a 31\/10\/2026/);assert.doesNotMatch(html,/01\/10\/2026 a 15\/10\/2026/);
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
test('closings show the fortnight total and daily count without an accumulated forecast',async()=>{
 const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
 const state=initialState();state.trucks=[{id:'daily',plate:'ABC1D23',driver:'Motorista',carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:40000,start:'2026-10-01',end:''}];app.mutateState(saved=>Object.assign(saved,state));await app.poll();app.run("currentMonth='2026-10';currentHalf=1;location.hash='#closings';render()");
 const html=app.get('#main').innerHTML;assert.doesNotMatch(html,/acumulad[oa]s? até|Total líquido acumulado|previsão até o fim da quinzena/);assert.match(html,/Diárias previstas na quinzena/);assert.match(html,/15 dia\(s\) na quinzena/);assert.match(html,/Líquido previsto: R\$\s?20\.000,00/);assert.match(html,/Saldo a pagar/);assert.match(html,/Pagamentos realizados/);assert.match(html,/Descontos da quinzena/);
});
test('fortnight preview groups transferred periods into one plate row and one end-activities action',async()=>{
 const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
 const state=initialState();state.trucks=[{id:'atv-origin',plate:'ATV2C70',driver:'JUNIOR',carrier:'BARROS',farmId:'farm1',bodyType:'Graneleiro',axles:7,monthly:35000,start:'2026-10-01',end:''}];
 transferTruck(state,'atv-origin','farm2','2026-10-12','','atv-veneza');transferTruck(state,'atv-veneza','farm1','2026-10-13','','atv-return');
 app.mutateState(saved=>Object.assign(saved,state));await app.poll();app.run("currentMonth='2026-10';currentHalf=1;farmFilter='';location.hash='#closings';render()");
 const html=app.get('#main').innerHTML,preview=html.slice(html.indexOf('Diárias previstas na quinzena'),html.indexOf('Totais por transportador'));
 assert.equal((preview.match(/class="plate">ATV2C70/g)||[]).length,1);assert.match(preview,/3 período\(s\)/);assert.match(preview,/15<span class="secondary">total na quinzena/);assert.match(preview,/R\$\s?17\.500,00/);assert.match(preview,/Detalhes \(3\)/);
 await app.action('fortnight-plate-detail','',{plate:'ATV2C70'});const details=app.get('#modal-content').innerHTML;
 assert.match(details,/Dados do caminhão/);assert.match(details,/Transportadora/);assert.match(details,/Valor mensal[\s\S]*R\$\s?35\.000,00/);assert.match(details,/Graneleiro/);assert.match(details,/7 eixos/);assert.match(details,/Início do contrato[\s\S]*01\/10\/2026/);
 assert.match(details,/Fazenda 1 · Fazenda 2/);assert.match(details,/Períodos considerados/);assert.match(details,/11\/10\/2026/);assert.equal((details.match(/data-action="end-activities"/g)||[]).length,1);assert.match(details,/data-id="atv-return"/);
});
test('open fortnight plate details explain each applied discount',async()=>{
 const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
 const state=initialState();state.trucks=[{id:'discount-truck',plate:'BCP5583',driver:'Motorista',carrier:'Transportadora',farmId:'farm1',bodyType:'Graneleiro',axles:9,monthly:40000,start:'2026-10-01',end:''}];
 state.discounts=[{id:'absence',truckId:'discount-truck',start:'2026-10-19',end:'2026-10-20',reason:'Falta',note:'Ausência sem justificativa'},{id:'advance',truckId:'discount-truck',start:'2026-10-21',end:'2026-10-21',kind:'amount',reason:'Valor',amount:500,note:'Adiantamento'}];
 app.mutateState(saved=>Object.assign(saved,state));await app.poll();app.run("currentMonth='2026-10';currentHalf=2;farmFilter='';location.hash='#closings';render()");await app.action('fortnight-plate-detail','',{plate:'BCP5583'});
 const details=app.get('#modal-content').innerHTML;assert.match(details,/O que está sendo descontado/);assert.match(details,/Falta/);assert.match(details,/19\/10\/2026 a 20\/10\/2026/);assert.match(details,/2 dia\(s\)/);assert.match(details,/Ausência sem justificativa/);assert.match(details,/Por valor/);assert.match(details,/21\/10\/2026/);assert.match(details,/R\$\s?500,00/);assert.match(details,/Adiantamento/);
});
test('navigation is grouped by workflow and the sample-data controls are removed',async()=>{
 const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
 const shell=fs.readFileSync(new URL('../frontend/index.html',import.meta.url),'utf8'),html=app.get('#main').innerHTML;
 assert.match(shell,/data-nav-section="operation"/);assert.match(shell,/data-nav-section="payments"/);assert.match(shell,/data-nav-section="fiscal"/);assert.match(shell,/data-nav-section="admin"/);
 assert.match(shell,/DIÁRIAS E PAGAMENTOS/);assert.match(shell,/CT-e recebidos/);assert.doesNotMatch(shell,/ETAPA 01|Uma quinzena de cada vez/);
 assert.doesNotMatch(html,/Testar com exemplos|Carregar dados de exemplo|Conheça o controle|data-action="demo"/);
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
  const html=app.get('#main').innerHTML;assert.doesNotMatch(html,/id="cte-farm-filter"/);assert.match(html,/Imprimir \/ Salvar PDF/);assert.match(html,/Fazenda: Fazenda 1 · 1 documento\(s\)/);assert.match(html,/ABC1234/);assert.doesNotMatch(html,/DEF5678|Remetente A/);
  app.run('ctePreferencesForm()');const modal=app.get('#modal-content').innerHTML;assert.doesNotMatch(modal,/Fazenda do relatório|cte-preference-farm-filter/);assert.match(modal,/data-cte-pref-column="farm"/);assert.match(modal,/<span>Fazenda<\/span>/);assert.match(modal,/filtro fica no cabeçalho da coluna/);
  app.run("ctePreferences={visibleColumns:['farm','number'],columnOrder:['farm','number']};main.innerHTML=ctesView()");const farmColumn=app.get('#main').innerHTML;assert.match(farmColumn,/FAZENDA/);assert.match(farmColumn,/Fazenda 1/);assert.match(farmColumn,/data-field="farm" aria-label="Filtrar por Fazenda"/);
  const css=fs.readFileSync(new URL('../frontend/styles.css',import.meta.url),'utf8');assert.match(css,/main:has\(\.cte-report-card\)>:not\(\.cte-report-card\)\{display:none!important\}/);assert.match(css,/@page cte-report\{size:A4 landscape;margin:0\}/);
  await app.action('cte-print');assert.equal(app.printCount(),1);
});
test('CPF and CNPJ share one CT-e report field per participant without losing saved preferences',async()=>{
  const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
  const parties=['shipper','recipient','serviceTaker','issuer'],oldColumns=parties.flatMap(party=>[party+'Cnpj',party+'Cpf']),mergedColumns=parties.map(party=>party+'Document');
  const prior=JSON.stringify({visibleColumns:oldColumns,columnOrder:[...oldColumns,'plate']}),saved=JSON.parse(app.run(`JSON.stringify(normalizeCtePreferences(JSON.parse(${JSON.stringify(prior)})))`));
  assert.deepEqual(saved.visibleColumns,[...mergedColumns,'cargoWeight','responseTime']);assert.deepEqual(saved.columnOrder.slice(0,4),mergedColumns);assert.equal(saved.columnOrder.length,app.run('ALL_CTE_COLUMNS.length'));
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
test('CT-e report shows the cargo weight and adds it to existing saved preferences',async()=>{
  const app=await boot();assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');
  const saved=JSON.stringify({visibleColumns:['number','plate'],columnOrder:['number','plate']});
  assert.deepEqual(JSON.parse(app.run(`JSON.stringify(normalizeCtePreferences(JSON.parse(${JSON.stringify(saved)})))`)).visibleColumns,['number','plate','cargoWeight','responseTime']);
  app.run("cteDocuments=[{id:'cte-weight',farmId:'farm1',farmName:'Fazenda 1',number:'123',plate:'ABC1234',cargoWeight:44222,cargoWeightUnit:'kg',issuedOn:'2026-10-08',totalValue:100}];cteFarms=[{id:'farm1',name:'Fazenda 1'}];ctePreferences={visibleColumns:['cargoWeight'],columnOrder:['cargoWeight']};main.innerHTML=ctesView()");
  assert.match(app.get('#main').innerHTML,/PESO DA CARGA/);assert.match(app.get('#main').innerHTML,/44\.222\s?kg/);
  app.run('ctePreferencesForm()');assert.match(app.get('#modal-content').innerHTML,/Peso da carga/);assert.match(app.get('#modal-content').innerHTML,/data-cte-pref-column="cargoWeight" checked/);
});
