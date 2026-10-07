import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {initialState,period,draft,saveClosing,validateState,transferTruck} from '../dist/engine.js';

const engine=fs.readFileSync(new URL('../dist/engine.js',import.meta.url),'utf8').replace(/^export /gm,'');
const reports=fs.readFileSync(new URL('../dist/reports.js',import.meta.url),'utf8').replace(/^import .*?;\r?\n/gm,'').replace(/^export /gm,'');
const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*?;\r?\n/gm,'');
const node=()=>({innerHTML:'',textContent:'',value:'',disabled:false,open:false,attributes:{},classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){this.attributes[k]=v;},addEventListener(){},scrollIntoView(){},focus(){},setSelectionRange(){},showModal(){this.open=true;},close(){this.open=false;}});
function boot(seed,legacy=null) {
  const elements=new Map(),handlers=new Map(),storage=new Map();
  if(seed)storage.set('frota-quinzenal-v2',JSON.stringify(seed));
  if(legacy)storage.set('frota-quinzenal-v1',JSON.stringify(legacy));
  const get=selector=>{if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);};
  const document={body:node(),querySelector:get,querySelectorAll:()=>[],addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);}};
  get('#modal').querySelector=get;
  class FormDataStub {constructor(form){this.data=form.data;}get(key){return this.data.get(key);}has(key){return this.data.has(key);}}
  const context=vm.createContext({document,window:{addEventListener(){},scrollTo(){},print(){context.printCount=(context.printCount||0)+1;}},location:{hash:'#overview'},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},Intl,URL,Blob,FormData:FormDataStub,crypto,structuredClone,setTimeout:()=>1,clearTimeout(){},console});
  vm.runInContext(engine+'\n'+reports+'\n'+app,context,{timeout:1000});
  return {context,get,storage,run:code=>vm.runInContext(code,context,{timeout:1000}),emit:(type,event)=>handlers.get(type)?.forEach(fn=>fn(event))};
}
function fixture() {
  const s=initialState();s.settings.confirmed=true;
  s.trucks=[{id:'a',plate:'ABC1D23',driver:'Motorista A',carrier:'Transportador A',farmId:'farm1',bodyType:'Caçamba',axles:7,monthly:40000,start:'2026-10-01',end:''},{id:'b',plate:'XYZ9B87',driver:'Motorista B',carrier:'Transportador B',farmId:'farm2',bodyType:'Graneleiro',axles:9,monthly:35000,start:'2026-10-06',end:''}];
  return s;
}

test('the application loads old unpaid closings with fixed monthly amounts and retains paid history',()=>{
  const s=fixture();s.settings={mode:'daily30',includeStart:true,includeEnd:true,confirmed:true};s.trucks.forEach(t=>{t.start='2026-10-01';t.monthly=30000;});
  const c=saveClosing(s,period('2026-10',2),'','legacy','2026-10-31');c.rows[1].paid={date:'2026-10-31',note:'Preservar'};
  const paid=JSON.stringify(c.rows[1]),app=boot(s);
  assert.equal(app.run('state.settings.mode'),'half');assert.equal(app.run('state.closings[0].rows[0].net'),15000);
  assert.equal(app.run('JSON.stringify(state.closings[0].rows[1])'),paid);
  app.run("location.hash='#settings';render();");
  assert.match(app.get('#main').innerHTML,/28, 29, 30 ou 31/);assert.doesNotMatch(app.get('#main').innerHTML,/<option[^>]*value="daily30"/);
});
test('the actual application module initializes and renders every view with empty and populated data',()=>{
  for(const seed of [null,fixture()]){
    const app=boot(seed);
    for(const hash of ['overview','trucks','discounts','closings','settings']){
      app.run(`location.hash='#${hash}';render();`);
      assert.ok(app.get('#main').innerHTML.length>100);
      assert.ok(!app.get('#main').innerHTML.includes('NaN'));
    }
  }
});
test('old saved data load in the UI with original payment history and explicit missing truck details',()=>{
  const s=fixture();s.schema=1;s.trucks.forEach(t=>{delete t.bodyType;delete t.axles;});
  const p=period('2026-10',1),rr=draft(s,p);rr[0].paid={date:'2026-10-15',note:'Original'};
  s.closings=[{id:'old',period:p,settings:s.settings,closedDate:'2026-10-15',rows:rr}];
  const app=boot(s);app.run("currentMonth='2026-10';currentHalf=1;location.hash='#closings';render();");
  assert.match(app.get('#main').innerHTML,/Pago/);
  assert.equal(app.run('state.closings[0].rows[0].paid.note'),'Original');
  app.run("location.hash='#trucks';render();");assert.match(app.get('#main').innerHTML,/A informar/);
});
test('date input handlers immediately expose inverted ranges and disable saving, then recover on correction',()=>{
  const app=boot(fixture()),start=node(),end=node(),error=node(),length=node(),submit=node();
  start.value='2026-10-08';end.value='2026-10-07';end.setCustomValidity=function(value){this.validationMessage=value;};
  const form={id:'discount-form',elements:{start,end},querySelector:s=>s==='.range-error'?error:s==='#discount-length'?length:submit};
  start.form=form;start.id='discount-start';
  app.emit('input',{target:start});
  assert.equal(error.textContent,'A data final não pode ser anterior à inicial.');assert.equal(submit.disabled,true);assert.equal(end.min,start.value);assert.doesNotMatch(length.textContent,/0 dia/);
  end.value='2026-10-08';app.emit('input',{target:start});assert.equal(submit.disabled,false);assert.match(length.textContent,/1 dia/);assert.equal(end.validationMessage,'');
  form.id='truck-form';end.value='2026-10-07';start.id='truck-start';app.emit('input',{target:start});assert.equal(submit.disabled,true);
});
test('the actual currency field blur handler formats whole amounts and preserves cents',()=>{
  const app=boot(fixture()),field=node();field.id='truck-monthly';field.setCustomValidity=function(v){this.validationMessage=v;};
  field.value='40000';app.emit('focusout',{target:field});assert.equal(field.value,'40.000,00');
  field.value='35000,75';app.emit('focusout',{target:field});assert.equal(field.value,'35.000,75');
});
test('farm selection changes the displayed total and actual confirmation closes only that farm',()=>{
  const app=boot(fixture());app.run("currentMonth='2026-10';currentHalf=1;location.hash='#closings';render();");
  app.get('#closing-farm').value='farm1';
  app.run('closePeriodModal();');
  assert.match(app.get('#modal-content').innerHTML,/Quais fazendas deseja fechar/);
  assert.match(app.get('#closing-preview').innerHTML,/20\.000,00/);
  assert.doesNotMatch(app.get('#closing-preview').innerHTML,/Fazenda 2/);
  const click={disabled:false,dataset:{action:'confirm-close'}};app.emit('click',{target:{closest:()=>click}});
  const saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));
  assert.deepEqual(saved.closings[0].farmIds,['farm1']);assert.equal(saved.closings[0].rows.length,1);
  assert.match(app.get('#main').innerHTML,/1 fazenda\(s\) fechada\(s\), 3 em aberto/);
  assert.match(app.get('#main').innerHTML,/Prévia/);
  app.get('#closing-farm').value='farm2';app.run('closePeriodModal();');app.emit('click',{target:{closest:()=>click}});
  const saved2=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved2.closings.length,2);
});
test('registration updates the monthly overview and complementary closings and payments remain in Fechamentos',()=>{
  const seed=fixture(),p=period('2026-10',1),old=saveClosing(seed,p,'','paid-base','2026-10-06');old.rows.forEach(r=>r.paid={date:'2026-10-06',note:'Anterior'});
  const prior=JSON.stringify(old),app=boot(seed);app.run("currentMonth='2026-10';currentHalf=1;render();");
  const box=node(),form={id:'truck-form',dataset:{id:''},data:new Map(Object.entries({plate:'NOV1A23',driver:'Motorista C',carrier:'Transportador C',farmId:'farm1',bodyType:'Caçamba',axles:'9',monthly:'35.000,00',start:'2026-10-06',end:''})),querySelector:()=>box};
  app.emit('submit',{target:form,preventDefault(){}});assert.equal(box.textContent,'');
  assert.match(app.get('#main').innerHTML,/NOV1A23/);assert.match(app.get('#main').innerHTML,/Resumo financeiro do mês/);assert.doesNotMatch(app.get('#main').innerHTML,/data-action="close-period"/);
  app.run("location.hash='#closings';render();");assert.match(app.get('#main').innerHTML,/fechamento complementar/);assert.match(app.get('#main').innerHTML,/Fechar pendências/);
  app.get('#closing-farm').value='farm1';app.run('closePeriodModal();');
  assert.match(app.get('#closing-preview').innerHTML,/11\.666,67/);assert.match(app.get('#closing-preview').innerHTML,/somente as placas/);
  const click={disabled:false,dataset:{action:'confirm-close'}};app.emit('click',{target:{closest:()=>click}});
  let saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved.closings.length,2);assert.equal(JSON.stringify(saved.closings[0]),prior);
  assert.equal(saved.closings[1].kind,'complement');assert.equal(saved.closings[1].rows.length,1);
  const truckId=saved.closings[1].rows[0].truckId;
  app.emit('submit',{target:{id:'payment-form',dataset:{id:truckId},data:new Map([['date','2026-10-06'],['note','Complemento']]),querySelector:()=>box},preventDefault(){}});
  saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved.closings[1].rows[0].paid.note,'Complemento');assert.equal(JSON.stringify(saved.closings[0]),prior);
});

function discountFixture(paid=false) {
  const s=fixture();s.discounts=[{id:'discount',truckId:'a',start:'2026-10-07',end:'2026-10-08',reason:'Falta',note:''}];
  const c=saveClosing(s,period('2026-10',1),'','original','2026-10-06');
  c.rows.find(r=>r.truckId==='b').paid={date:'2026-10-06',note:'Outra fazenda'};
  if(paid)c.rows.find(r=>r.truckId==='a').paid={date:'2026-10-06',note:'Pago antes'};
  return s;
}
function action(app,name,id='discount',extra={}) {
  const button={disabled:false,dataset:{action:name,id,...extra}};
  app.emit('click',{target:{closest:()=>button}});
}
test('closed discounts always show edit and delete, and paid entries open a payment review without changing records',()=>{
  const seed=discountFixture(true),app=boot(seed),original=app.storage.get('frota-quinzenal-v2');
  app.run("currentMonth='2026-10';currentHalf=1;location.hash='#discounts';render();");
  assert.match(app.get('#main').innerHTML,/data-action="edit-discount"/);
  assert.match(app.get('#main').innerHTML,/data-action="delete-discount"/);
  assert.match(app.get('#main').innerHTML,/Período fechado/);
  action(app,'edit-discount');assert.match(app.get('#modal-content').innerHTML,/Ver pagamento registrado/);assert.doesNotMatch(app.get('#modal-content').innerHTML,/confirm-discount-reopen-edit/);
  assert.equal(app.storage.get('frota-quinzenal-v2'),original);
  action(app,'review-discount-payment','a',{closing:'original',farm:'farm1'});assert.match(app.get('#modal-content').innerHTML,/Desfazer registro de pagamento/);
  assert.equal(app.storage.get('frota-quinzenal-v2'),original);
  action(app,'delete-discount');assert.match(app.get('#modal-content').innerHTML,/Ver pagamento registrado/);assert.equal(app.storage.get('frota-quinzenal-v2'),original);
});
test('guided deletion reopens only the affected farm and preserves another farm paid snapshot',()=>{
  const seed=discountFixture(),paid=structuredClone(seed.closings[0].rows.find(r=>r.truckId==='b')),app=boot(seed);
  app.run("currentMonth='2026-10';currentHalf=1;location.hash='#discounts';render();");
  action(app,'delete-discount');assert.match(app.get('#modal-content').innerHTML,/Reabrir e excluir/);
  action(app,'confirm-discount-reopen-delete');
  const saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved.discounts.length,0);
  assert.ok(!saved.closings.some(c=>c.rows.some(r=>r.truckId==='a')));
  assert.deepEqual(saved.closings[0].rows.find(r=>r.truckId==='b'),paid);
  assert.deepEqual(validateState(saved),saved);
});
test('guided editing unlocks the form, saves the revised discount and preserves other farm payments',()=>{
  const seed=discountFixture(),paid=structuredClone(seed.closings[0].rows.find(r=>r.truckId==='b')),app=boot(seed);
  app.run("currentMonth='2026-10';currentHalf=1;location.hash='#discounts';render();");
  const form=app.get('#discount-form'),start=node(),end=node(),range=node(),length=node(),submit=node(),error=node();
  start.value='2026-10-07';end.value='2026-10-08';end.setCustomValidity=function(v){this.validationMessage=v;};
  form.id='discount-form';form.dataset={id:'discount'};form.elements={start,end};form.querySelector=s=>s==='.range-error'?range:s==='#discount-length'?length:s==='[type="submit"]'?submit:error;
  action(app,'edit-discount');assert.match(app.get('#modal-content').innerHTML,/Reabrir e editar/);
  action(app,'confirm-discount-reopen-edit');assert.match(app.get('#modal-content').innerHTML,/Editar desconto/);
  form.data=new Map(Object.entries({truckId:'a',start:'2026-10-07',end:'2026-10-10',reason:'Falta',note:'Corrigido'}));
  app.emit('submit',{target:form,preventDefault(){}});
  const saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved.discounts[0].end,'2026-10-10');assert.equal(saved.discounts[0].note,'Corrigido');
  assert.deepEqual(saved.closings[0].rows.find(r=>r.truckId==='b'),paid);assert.deepEqual(validateState(saved),saved);
});
test('the transfer form records two farm periods and shows the dated movement in truck history',()=>{
  const seed=fixture(),app=boot(seed);app.run("currentMonth='2026-10';currentHalf=1;location.hash='#trucks';render();");
  assert.match(app.get('#main').innerHTML,/Transferir fazenda/);assert.match(app.get('#main').innerHTML,/Histórico/);
  const form=app.get('#transfer-form'),submit=node(),error=node();form.id='transfer-form';form.dataset={id:'a'};form.querySelector=s=>s==='[type="submit"]'?submit:error;
  app.get('#transfer-farm').value='farm2';app.get('#transfer-date').value='2026-10-10';
  action(app,'transfer-truck','a');assert.match(app.get('#transfer-preview').innerHTML,/Fazenda 1/);assert.match(app.get('#transfer-preview').innerHTML,/09\/10\/2026/);assert.equal(submit.disabled,false);
  form.data=new Map([['toFarmId','farm2'],['date','2026-10-10'],['note','Mudança de frente']]);app.emit('submit',{target:form,preventDefault(){}});
  const saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved.trucks.length,3);assert.equal(saved.trucks.find(t=>t.id==='a').end,'2026-10-09');
  const to=saved.trucks.find(t=>t.transferIn?.fromTruckId==='a');assert.equal(to.farmId,'farm2');assert.equal(to.start,'2026-10-10');assert.equal(to.monthly,40000);
  assert.deepEqual(validateState(saved),saved);
  action(app,'truck-history',to.id);assert.match(app.get('#modal-content').innerHTML,/Mudança de frente/);assert.match(app.get('#modal-content').innerHTML,/Transferência para Fazenda 2/);
});
test('the transfer preview identifies and blocks an already paid period, and history retains its deductions',()=>{
  const seed=discountFixture(true),original=JSON.stringify(seed),app=boot(seed);
  app.run("currentMonth='2026-10';currentHalf=1;location.hash='#trucks';render();");
  const form=app.get('#transfer-form'),submit=node();form.id='transfer-form';form.dataset={id:'a'};form.querySelector=()=>submit;
  app.get('#transfer-farm').value='farm2';app.get('#transfer-date').value='2026-10-10';
  action(app,'transfer-truck','a');assert.equal(submit.disabled,true);assert.match(app.get('#transfer-preview').innerHTML,/Ver fechamento/);assert.match(app.get('#transfer-preview').innerHTML,/Pago/);
  assert.equal(app.storage.get('frota-quinzenal-v2'),original);
  action(app,'truck-history','a');assert.match(app.get('#modal-content').innerHTML,/Descontos: R\$/);assert.match(app.get('#modal-content').innerHTML,/Pago em 06\/10\/2026/);
  assert.equal(app.storage.get('frota-quinzenal-v2'),original);
});
test('details offer ending activities and confirmation closes only the selected plate at the entered date',()=>{
  const seed=discountFixture(),other=structuredClone(seed.closings[0].rows.find(r=>r.truckId==='b')),app=boot(seed);
  app.run("currentMonth='2026-10';currentHalf=1;location.hash='#closings';render();");
  action(app,'detail','a');assert.match(app.get('#modal-content').innerHTML,/Encerrar atividades/);
  const form=app.get('#end-activities-form'),submit=node(),error=node();form.id='end-activities-form';form.dataset={id:'a'};form.querySelector=s=>s==='[type="submit"]'?submit:error;
  app.get('#activity-end-date').value='2026-10-10';action(app,'end-activities','a');
  assert.equal(submit.disabled,false);assert.match(app.get('#activity-end-preview').innerHTML,/10\.666,67/);assert.match(app.get('#activity-end-preview').innerHTML,/10\/10\/2026/);
  form.data=new Map([['date','2026-10-10'],['note','Serviço concluído']]);app.emit('submit',{target:form,preventDefault(){}});
  const saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved.trucks.find(t=>t.id==='a').end,'2026-10-10');
  const c=saved.closings.find(c=>c.kind==='activity-end');assert.equal(c.rows.length,1);assert.equal(c.rows[0].truckId,'a');assert.equal(c.rows[0].end,'2026-10-10');assert.equal(c.rows[0].net,10666.67);
  assert.deepEqual(saved.closings.find(c=>c.id==='original').rows.find(r=>r.truckId==='b'),other);assert.deepEqual(validateState(saved),saved);
  action(app,'truck-history','a');assert.match(app.get('#modal-content').innerHTML,/Valores anteriores revisados/);assert.match(app.get('#modal-content').innerHTML,/Serviço concluído/);
});
test('ending preview keeps paid rows unchanged and explains why a conflicting date cannot be confirmed',()=>{
  const seed=discountFixture(true),before=JSON.stringify(seed),app=boot(seed);app.run("currentMonth='2026-10';currentHalf=1;");
  const form=app.get('#end-activities-form'),submit=node();form.id='end-activities-form';form.dataset={id:'a'};form.querySelector=()=>submit;
  app.get('#activity-end-date').value='2026-10-10';action(app,'end-activities','a');
  assert.equal(submit.disabled,true);assert.match(app.get('#activity-end-preview').innerHTML,/Ver pagamento registrado/);assert.equal(app.storage.get('frota-quinzenal-v2'),before);
});

test('report actions preview, filter, print and return without changing local records',()=>{
  const seed=discountFixture(),before=JSON.stringify(seed),app=boot(seed);app.run("currentMonth='2026-10';currentHalf=1;farmFilter='';location.hash='#closings';render();");
  assert.match(app.get('#main').innerHTML,/data-action="report"/);action(app,'report','');
  assert.equal(app.get('#report-dialog').open,true);assert.match(app.get('#report-preview').innerHTML,/Fazenda 1/);assert.match(app.get('#report-preview').innerHTML,/Fazenda 2/);
  assert.match(app.get('#report-content').innerHTML,/<label>Placa<select id="report-plate">/);
  app.get('#report-plate').value='XYZ9B87';app.emit('change',{target:{id:'report-plate'}});
  assert.match(app.get('#report-preview').innerHTML,/XYZ9B87/);assert.doesNotMatch(app.get('#report-preview').innerHTML,/ABC1D23/);assert.match(app.get('#report-page-count').textContent,/1 caminhão/);
  app.get('#report-farm').value='farm2';app.get('#report-scope').value='paid';app.emit('change',{target:{id:'report-scope'}});
  assert.match(app.get('#report-preview').innerHTML,/Fazenda 2/);assert.doesNotMatch(app.get('#report-preview').innerHTML,/Fazenda 1/);assert.equal(app.get('#report-print').disabled,false);
  action(app,'print-report','');assert.equal(app.context.printCount,1);
  app.get('#report-farm').value='farm1';app.emit('change',{target:{id:'report-farm'}});assert.equal(app.get('#report-print').disabled,true);assert.match(app.get('#report-preview').innerHTML,/Nenhum pagamento registrado/);
  app.get('#report-plate').value='';app.get('#report-farm').value='';app.emit('change',{target:{id:'report-plate'}});assert.equal(app.get('#report-print').disabled,false);
  app.get('#report-plate').value='ABC1D23';app.emit('change',{target:{id:'report-plate'}});assert.equal(app.get('#report-print').disabled,true);
  action(app,'print-report','');assert.equal(app.context.printCount,1);action(app,'close-report','');assert.equal(app.get('#report-dialog').open,false);
  assert.equal(app.storage.get('frota-quinzenal-v2'),before);
});
test('history report buttons open the saved period independently of the current month and farm',()=>{
  const seed=discountFixture(true),app=boot(seed);app.run("currentMonth='2026-11';currentHalf=2;farmFilter='farm2';location.hash='#closings';render();");
  assert.match(app.get('#main').innerHTML,/data-action="report" data-id="original"/);action(app,'report','original');
  assert.match(app.get('#report-preview').innerHTML,/01\/10\/2026 a 15\/10\/2026/);assert.match(app.get('#report-preview').innerHTML,/Fazenda 1/);assert.match(app.get('#report-preview').innerHTML,/Fazenda 2/);
  assert.equal(app.run('currentMonth'),'2026-11');assert.equal(app.run('farmFilter'),'farm2');
});

test('report fortnight selection preserves the plate filters and changes historical amounts without altering records',()=>{
  const seed=discountFixture(true),second=saveClosing(seed,period('2026-10',2),'','second','2026-10-31');second.rows.find(row=>row.truckId==='a').paid={date:'2026-10-31',note:'Segunda quinzena'};
  const before=JSON.stringify(seed),app=boot(seed);app.run("currentMonth='2026-12';currentHalf=1;");action(app,'report','original');
  assert.match(app.get('#report-content').innerHTML,/id="report-month"/);assert.match(app.get('#report-content').innerHTML,/id="report-half"/);
  app.get('#report-plate').value='ABC1D23';app.get('#report-scope').value='paid';app.emit('change',{target:{id:'report-plate'}});
  assert.match(app.get('#report-preview').innerHTML,/17\.333,33/);
  app.get('#report-half').value='2';app.emit('change',{target:{id:'report-half'}});
  assert.match(app.get('#report-preview').innerHTML,/16\/10\/2026 a 31\/10\/2026/);assert.match(app.get('#report-preview').innerHTML,/20\.000,00/);assert.doesNotMatch(app.get('#report-preview').innerHTML,/XYZ9B87/);
  assert.equal(app.get('#report-plate').value,'ABC1D23');assert.equal(app.get('#report-scope').value,'paid');assert.equal(app.run('reportContext.closingId'),'');
  app.get('#report-month').value='2026-11';app.get('#report-half').value='1';app.emit('change',{target:{id:'report-month'}});
  assert.equal(app.get('#report-print').disabled,true);assert.match(app.get('#report-preview').innerHTML,/Nenhum pagamento registrado/);assert.equal(app.get('#report-period-caption').textContent,'01/11/2026 a 15/11/2026');
  app.get('#report-month').value='';app.emit('change',{target:{id:'report-month'}});assert.match(app.get('#report-preview').innerHTML,/Selecione a competência e a quinzena/);
  app.get('#report-scope').value='all';app.emit('change',{target:{id:'report-scope'}});assert.equal(app.get('#report-print').disabled,true);
  app.get('#report-month').value='2026-10';app.get('#report-half').value='2';app.get('#report-scope').value='paid';app.emit('change',{target:{id:'report-month'}});assert.equal(app.get('#report-print').disabled,false);
  assert.equal(app.run('currentMonth'),'2026-12');assert.equal(app.storage.get('frota-quinzenal-v2'),before);
});

test('farm registration saves additional farms with stable IDs and preserves paid snapshots and closed periods',()=>{
  const seed=discountFixture(true),paid=structuredClone(seed.closings),app=boot(seed);app.run("currentMonth='2026-10';currentHalf=1;location.hash='#settings';render();");
  assert.match(app.get('#main').innerHTML,/Adicionar fazenda/);assert.doesNotMatch(app.get('#main').innerHTML,/suas quatro fazendas/);
  const inputs=seed.farms.map(farm=>({dataset:{farmId:farm.id},value:farm.name,focus(){}})),error=node(),form=app.get('#farms-form');
  form.id='farms-form';form.data=new Map();form.querySelectorAll=()=>inputs;form.querySelector=selector=>selector.startsWith('[data-farm-id=')?inputs.at(-1):error;
  app.get('#farm-fields').insertAdjacentHTML=(position,html)=>{const id=html.match(/data-farm-id="([^"]+)"/)[1];inputs.push({dataset:{farmId:id},value:'',focus(){}});};
  action(app,'add-farm','');inputs.at(-1).value='Nova Fazenda';const newId=inputs.at(-1).dataset.farmId;
  action(app,'add-farm','');inputs.at(-1).value='Santa Luzia';
  app.emit('submit',{target:form,preventDefault(){}});
  const saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved.farms.length,6);assert.equal(saved.farms[4].id,newId);assert.deepEqual(saved.farms.slice(0,4),seed.farms);
  assert.deepEqual(saved.closings,paid);assert.deepEqual(validateState(saved),saved);assert.equal(app.run('!!closing()'),true);
  app.run('truckForm();');assert.match(app.get('#modal-content').innerHTML,/Nova Fazenda/);assert.match(app.get('#modal-content').innerHTML,/Santa Luzia/);
  action(app,'report','');assert.match(app.get('#report-content').innerHTML,/Nova Fazenda/);
  const restored=boot(saved);assert.equal(restored.run('state.farms.length'),6);
});

test('farm registration rejects empty and duplicate names without changing stored records',()=>{
  const seed=fixture(),before=JSON.stringify(seed),app=boot(seed),error=node();
  const inputs=seed.farms.map(farm=>({dataset:{farmId:farm.id},value:farm.name}));inputs.push({dataset:{farmId:'new'},value:''});
  const form={id:'farms-form',data:new Map(),querySelectorAll:()=>inputs,querySelector:()=>error};
  app.emit('submit',{target:form,preventDefault(){}});assert.match(error.textContent,/Preencha/);assert.equal(app.storage.get('frota-quinzenal-v2'),before);
  inputs.at(-1).value='  FAZENDA 1  ';app.emit('submit',{target:form,preventDefault(){}});assert.match(error.textContent,/nomes diferentes/);assert.equal(app.storage.get('frota-quinzenal-v2'),before);
});

test('farm removal requires confirmation and removes only the unused farm while retaining unsaved names',()=>{
  const seed=fixture(),before=JSON.stringify(seed),app=boot(seed);app.run("location.hash='#settings';render();");
  assert.match(app.get('#main').innerHTML,/data-action="remove-farm" data-id="farm3"/);
  const inputs=seed.farms.map(farm=>({dataset:{farmId:farm.id},value:farm.id==='farm1'?'Nome ainda não salvo':farm.name}));
  app.get('#farms-form').querySelectorAll=()=>inputs;
  action(app,'remove-farm','farm3');assert.match(app.get('#modal-content').innerHTML,/confirm-remove-farm/);assert.equal(app.storage.get('frota-quinzenal-v2'),before);
  action(app,'confirm-remove-farm','farm3');const saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));
  assert.ok(!saved.farms.some(farm=>farm.id==='farm3'));assert.equal(saved.farms.find(farm=>farm.id==='farm1').name,'Fazenda 1');assert.deepEqual(saved.trucks,seed.trucks);assert.deepEqual(validateState(saved),saved);
  assert.match(app.get('#farm-fields').innerHTML,/Nome ainda não salvo/);assert.doesNotMatch(app.get('#farm-fields').innerHTML,/data-farm-id="farm3"/);
});

test('farm inactivation and reactivation preserve paid history and remain compatible with saving names and backups',()=>{
  const seed=discountFixture(true),snapshots=structuredClone(seed.closings),app=boot(seed);app.run("currentMonth='2026-10';currentHalf=1;location.hash='#settings';render();");
  assert.match(app.get('#main').innerHTML,/data-action="inactivate-farm" data-id="farm1"/);
  const inputs=seed.farms.map(farm=>({dataset:{farmId:farm.id},value:farm.name}));inputs.push({dataset:{farmId:'draft-farm'},value:'Nova fazenda em edição'});
  const form=app.get('#farms-form');form.id='farms-form';form.data=new Map();form.querySelectorAll=()=>inputs;form.querySelector=()=>node();
  action(app,'inactivate-farm','farm1');assert.match(app.get('#modal-content').innerHTML,/confirm-inactivate-farm/);action(app,'confirm-inactivate-farm','farm1');
  let saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved.farms[0].active,false);assert.deepEqual(saved.closings,snapshots);assert.match(app.get('#farm-fields').innerHTML,/Reativar/);assert.match(app.get('#farm-fields').innerHTML,/Nova fazenda em edição/);
  app.emit('submit',{target:form,preventDefault(){}});saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved.farms[0].active,false);assert.deepEqual(validateState(saved),saved);
  app.run('truckForm();');assert.doesNotMatch(app.get('#modal-content').innerHTML,/Fazenda 1/);app.run("truckForm('a');");assert.match(app.get('#modal-content').innerHTML,/Fazenda 1 \(Inativa\)/);
  action(app,'report','');assert.match(app.get('#report-preview').innerHTML,/Fazenda 1/);assert.match(app.get('#report-preview').innerHTML,/17\.333,33/);action(app,'close-report','');
  const restored=boot(saved);assert.equal(restored.run('state.farms[0].active'),false);
  action(app,'reactivate-farm','farm1');saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved.farms[0].active,true);assert.deepEqual(saved.closings,snapshots);
  app.run('truckForm();');assert.match(app.get('#modal-content').innerHTML,/Fazenda 1/);
});

test('example loading uses only active farms, including when one farm remains available',()=>{
  const seed=initialState();seed.farms=seed.farms.slice(0,2);seed.farms[0].active=false;const app=boot(seed);action(app,'demo','');
  const saved=JSON.parse(app.storage.get('frota-quinzenal-v2'));assert.equal(saved.trucks.length,3);assert.ok(saved.trucks.every(truck=>truck.farmId==='farm2'));assert.deepEqual(validateState(saved),saved);
  seed.farms[1].active=false;const empty=boot(seed),before=empty.storage.get('frota-quinzenal-v2');action(empty,'demo','');assert.equal(empty.storage.get('frota-quinzenal-v2'),before);assert.match(empty.get('#toast').textContent,/reative uma fazenda/);
});

test('monthly overview reconciles paid, closed and open values across both fortnights and respects farm filters',()=>{
  const seed=discountFixture(),before=JSON.stringify(seed),app=boot(seed);
  const d=JSON.parse(app.run("JSON.stringify(overviewData('2026-10','','2026-10-06'))"));
  assert.equal(d.monthTrucks,2);assert.equal(d.activeTrucks,2);assert.equal(d.entries,2);assert.equal(d.endings,0);
  assert.equal(d.paid,11666.67);assert.equal(d.waiting,17333.33);assert.equal(d.open,37500);assert.equal(d.total,66500);assert.equal(Math.round((d.paid+d.waiting+d.open)*100),Math.round(d.total*100));
  const farm=JSON.parse(app.run("JSON.stringify(overviewData('2026-10','farm1','2026-10-06'))"));assert.equal(farm.monthTrucks,1);assert.equal(farm.total,37333.33);assert.equal(farm.paid,0);
  assert.equal(app.storage.get('frota-quinzenal-v2'),before);
});

test('overview counts a transferred plate once and uses explicit reference dates for past and future months',()=>{
  const seed=fixture();transferTruck(seed,'a','farm2','2026-10-10','','to');const app=boot(seed);
  const d=JSON.parse(app.run("JSON.stringify(overviewData('2026-10','','2026-10-15'))"));
  assert.equal(d.monthTrucks,2);assert.equal(d.activeTrucks,2);assert.equal(d.entries,2);assert.equal(d.endings,0);assert.equal(d.events.filter(event=>event.label==='Transferência').length,1);
  assert.equal(d.types.Caçamba,1);assert.equal(d.types.Graneleiro,1);assert.equal(d.farms.find(farm=>farm.id==='farm2').activeTrucks,2);assert.equal(d.farms.find(farm=>farm.id==='farm1').activeTrucks,0);
  const past=JSON.parse(app.run("JSON.stringify(overviewData('2026-09','','2026-10-15'))"));assert.equal(past.reference,'2026-09-30');assert.equal(past.monthTrucks,0);
  const future=JSON.parse(app.run("JSON.stringify(overviewData('2026-11','','2026-10-15'))"));assert.equal(future.reference,'2026-11-01');assert.equal(future.referenceLabel,'Previstos no início do mês');
});

test('overview displays fleet information while all closing and report actions are centralized in Fechamentos',()=>{
  const app=boot(discountFixture(true));app.run("currentMonth='2026-10';location.hash='#overview';render();");
  const dashboard=app.get('#main').innerHTML;assert.match(dashboard,/Caminhões por fazenda/);assert.match(dashboard,/Perfil dos caminhões/);assert.match(dashboard,/Movimentações no mês/);assert.match(dashboard,/href="#closings"/);
  assert.doesNotMatch(dashboard,/data-action="(?:report|export-csv|close-period|show-closing|reopen-period|detail)"|data-action="half"/);
  app.run("location.hash='#closings';render();");const closing=app.get('#main').innerHTML;assert.match(closing,/Demonstrativo por caminhão/);assert.match(closing,/data-action="report"/);assert.match(closing,/data-action="export-csv"/);assert.match(closing,/Total líquido da quinzena/);
});

test('the clean release removes legacy trial data and keeps newly entered records on subsequent loads',()=>{
  const legacy=discountFixture(true);legacy.farms[0].name='Nome cadastrado anteriormente';const clean=boot(null,legacy);
  assert.equal(clean.storage.has('frota-quinzenal-v1'),false);assert.equal(clean.run('state.trucks.length'),0);assert.equal(clean.run('state.discounts.length'),0);assert.equal(clean.run('state.closings.length'),0);assert.equal(clean.run('state.farms[0].name'),'Fazenda 1');
  const newlyEntered=fixture(),current=boot(newlyEntered,legacy);assert.equal(current.run('state.trucks.length'),2);assert.equal(current.storage.has('frota-quinzenal-v1'),false);assert.deepEqual(JSON.parse(current.storage.get('frota-quinzenal-v2')),newlyEntered);
});
