import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,period,saveClosing,transferTruck,validateState} from '../server/engine.js';
import {createReport,reportMarkup} from '../frontend/reports.js';

function fleet(count=40){
  const state=initialState();
  state.trucks=Array.from({length:count},(_,index)=>({id:'t'+index,plate:'ABC'+String(index).padStart(4,'0'),driver:'Motorista '+index,carrier:'Transportador '+Math.floor(index/10),farmId:state.farms[Math.floor(index/10)%4].id,bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-09-01',end:''}));
  return state;
}
test('40 paid trucks generate four farm pages with reconciled totals and five report columns',()=>{
  const state=fleet(),p=period('2026-10',2),c=saveClosing(state,p,'','paid','2026-10-31');c.rows.forEach(row=>row.paid={date:'2026-10-31',note:''});
  const before=structuredClone(state),report=createReport(state,p),html=reportMarkup(report);
  assert.equal(report.pages.length,4);assert.equal(report.truckCount,40);assert.equal(report.total,600000);
  for(const page of report.pages){assert.equal(page.rows.length,10);assert.equal(page.total,150000);assert.equal(page.status,'Pagos');assert.equal(new Set(page.rows.map(row=>row.farmId)).size,1);}
  assert.equal((html.match(/<th[ >]/g)||[]).length,20);assert.match(html,/Página 4 de 4/);assert.match(html,/Total líquido da quinzena/);
  assert.deepEqual(state,before);
});
test('farm and paid filters exclude unpaid rows and preserve the historical names, amounts and discounts',()=>{
  const state=fleet(2),p=period('2026-10',2);state.discounts=[{id:'d',truckId:'t0',start:'2026-10-20',end:'2026-10-20',reason:'Oficina',note:'Registro original'}];
  const c=saveClosing(state,p,'','original','2026-10-31');c.rows[0].paid={date:'2026-10-31',note:''};
  state.trucks[0].monthly=90000;state.trucks[0].driver='Outro nome';state.farms[0].name='Nome novo';state.discounts[0].note='Texto novo';
  const report=createReport(state,p,{farmId:'farm1',onlyPaid:true}),html=reportMarkup(report);
  assert.equal(report.truckCount,1);assert.equal(report.total,14062.5);assert.equal(report.pages[0].farmName,'Fazenda 1');
  assert.match(html,/Registro original/);assert.doesNotMatch(html,/Texto novo|Outro nome|Nome novo/);assert.match(html,/Somente pagos/);
  assert.match(html,/<div class="report-truck-heading"><strong>ABC0000<\/strong><span class="report-start">Início: 01\/09\/2026<\/span>/);
  assert.equal(createReport(state,p,{farmId:'farm2'}).pages.length,0);
});
test('a mixed closing reports paid total, pending balance and individual status without marking the whole page paid',()=>{
  const state=fleet(2),p=period('2026-10',2),c=saveClosing(state,p,'','mixed','2026-10-31');c.rows[0].paid={date:'2026-10-31',note:''};
  const report=createReport(state,p),html=reportMarkup(report);assert.equal(report.pages[0].status,'Fechados, aguardando pagamento');assert.equal(report.pages[0].paid,15000);assert.equal(report.total,30000);
  assert.match(html,/Saldo a pagar: R\$\s15\.000,00/);assert.match(html,/Pago em 31\/10\/2026/);assert.match(html,/>Fechado<\/span>/);assert.doesNotMatch(html,/>Total pago</);
});
test('a report from history includes only its selected closing, excluding late complementary registrations',()=>{
  const state=fleet(1),p=period('2026-10',2);saveClosing(state,p,'','original','2026-10-31');
  state.trucks.push({...state.trucks[0],id:'late',plate:'XYZ9B87'});saveClosing(state,p,'farm1','complement','2026-10-31');
  assert.equal(createReport(state,p).truckCount,2);const report=createReport(state,p,{closingId:'original'});assert.equal(report.truckCount,1);assert.equal(report.total,15000);assert.deepEqual(validateState(state),state);
});
test('cross-period discounts are clipped to the saved service range and long notes get continuation pages',()=>{
  const state=fleet(1),p=period('2026-10',2);state.trucks[0].end='2026-10-25';
  state.discounts=[{id:'d',truckId:'t0',start:'2026-10-14',end:'2026-10-18',reason:'Falta',note:'Explicação extensa '.repeat(35)}];
  saveClosing(state,p,'','closed','2026-10-31');
  const report=createReport(state,p),html=reportMarkup(report);assert.equal(report.pages[0].rows[0].payableDays,7);assert.equal(report.total,6562.5);
  assert.ok(report.pages.some(page=>page.kind==='notes'));assert.match(html,/16\/10\/2026 a 18\/10\/2026: 3 dia/);assert.doesNotMatch(html,/Atividades encerradas/);
  assert.equal(report.pages.filter(page=>page.kind==='trucks').reduce((n,page)=>n+page.total,0),report.total);
});
test('transfers appear in their respective farms without duplicating the plate financial total',()=>{
  const state=fleet(1),p=period('2026-10',2);transferTruck(state,'t0','farm2','2026-10-20','','to');
  const report=createReport(state,p),html=reportMarkup(report);assert.equal(report.truckCount,1);assert.equal(report.farmCount,2);assert.equal(report.total,15000);
  assert.match(html,/Início: 01\/09\/2026/);assert.match(html,/Início: 20\/10\/2026/);assert.doesNotMatch(html,/Transferência|Atividades encerradas|Observações/);
});
test('reports escape names and observations while large farms and long names paginate without losing rows',()=>{
  const state=fleet(25),p=period('2026-10',2);state.trucks.forEach(row=>{row.farmId='farm1';row.carrier='<img src=x onerror=alert(1)> '+ 'Transportador longo '.repeat(5);});
  const report=createReport(state,p),html=reportMarkup(report),printed=report.pages.flatMap(page=>page.rows);
  assert.ok(report.pages.length>3);assert.equal(printed.length,25);assert.equal(new Set(printed.map(row=>row.truckId)).size,25);assert.equal(report.total,375000);
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/Total líquido da fazenda/);
});

test('plate filtering combines farm and paid filters and retains both parts of a transferred truck',()=>{
  const state=fleet(2),p=period('2026-10',2);transferTruck(state,'t0','farm2','2026-10-20','','to');
  const closing=saveClosing(state,p,'','closed','2026-10-31');closing.rows.filter(row=>row.plate==='ABC0000').forEach(row=>row.paid={date:'2026-10-31',note:''});
  const before=structuredClone(state),report=createReport(state,p,{plate:'ABC0000',onlyPaid:true}),html=reportMarkup(report);
  assert.equal(report.truckCount,1);assert.equal(report.farmCount,2);assert.equal(report.total,15000);assert.equal(report.pages.flatMap(page=>page.rows).length,2);
  assert.match(html,/Placa: ABC0000/);assert.doesNotMatch(html,/ABC0001/);assert.match(html,/Total líquido da placa/);
  assert.equal(createReport(state,p,{plate:'ABC0000',farmId:'farm2',onlyPaid:true}).total,11250);
  assert.equal(createReport(state,p,{plate:'ABC0001',onlyPaid:true}).pages.length,0);
  assert.equal(createReport(state,p,{plate:'XYZ9B87'}).total,0);assert.deepEqual(state,before);
});
