import test from 'node:test';
import assert from 'node:assert/strict';
import {period,calculate,initialState,validateTruck,validateDiscount,draft,validateState,csv,parseAmount,amountLabel,dateRangeError,periodRows,farmClosing,saveClosing,reopenClosing,discountLocked,SCHEMA,transferTruck,previewTransfer,days,previewEndActivities,endActivities,applyFixedMonthlyRule,farmHasLinks,removeFarm,setFarmActive,openFarmIds} from '../dist/engine.js';

const truck={id:'a',plate:'ABC1D23',driver:'João',carrier:'Transportes',farmId:'farm1',monthly:40000,start:'2026-10-06',end:'2026-11-10'};
const settings={mode:'daily30',includeStart:true,includeEnd:true,confirmed:true};
test('only farms without truck or closing links can be removed and at least one farm remains',()=>{
  const s=initialState();s.trucks=[{...truck,end:''}];assert.equal(farmHasLinks(s,'farm3'),false);removeFarm(s,'farm3');assert.equal(s.farms.length,3);assert.deepEqual(validateState(s),s);
  const before=structuredClone(s);assert.throws(()=>removeFarm(s,'farm1'),/Inativar/);assert.deepEqual(s,before);
  const one=initialState();one.farms=[one.farms[0]];assert.throws(()=>removeFarm(one,'farm1'),/última/);assert.equal(one.farms.length,1);
});
test('an empty farm included in a saved closing remains linked and cannot be physically removed',()=>{
  const s=initialState();s.trucks=[{...truck,end:''}];saveClosing(s,period('2026-10',1),'','closed','2026-10-15');
  const before=structuredClone(s);assert.equal(farmHasLinks(s,'farm3'),true);assert.throws(()=>removeFarm(s,'farm3'),/Inativar/);assert.deepEqual(s,before);
});
test('farm inactivation preserves contracts, discounts and paid snapshots while blocking new assignments',()=>{
  const s=initialState();s.trucks=[{...truck,end:''}];s.discounts=[{id:'d',truckId:'a',start:'2026-10-07',end:'2026-10-08',reason:'Falta',note:''}];
  const p=period('2026-10',1),c=saveClosing(s,p,'','paid','2026-10-15');c.rows[0].paid={date:'2026-10-15',note:'Preservar'};
  const snapshot=structuredClone(c),contracts=structuredClone(s.trucks),discounts=structuredClone(s.discounts),future=draft(s,period('2026-10',2));
  setFarmActive(s,'farm1',false);assert.deepEqual(s.closings[0],snapshot);assert.deepEqual(s.trucks,contracts);assert.deepEqual(s.discounts,discounts);assert.deepEqual(draft(s,period('2026-10',2)),future);assert.deepEqual(validateState(s),s);
  validateTruck({...s.trucks[0],driver:'Nome atualizado'},s);assert.throws(()=>validateTruck({...truck,id:'new',plate:'XYZ9B87',end:''},s),/Reative/);
  s.trucks.push({...truck,id:'b',plate:'DEF1234',farmId:'farm2',end:''});assert.throws(()=>previewTransfer(s,'b','farm1','2026-10-20'),/Reative/);
  setFarmActive(s,'farm1',true);validateTruck({...truck,id:'new',plate:'XYZ9B87',end:''},s);assert.deepEqual(s.closings[0],snapshot);
});
test('inactive farms with pending trucks can close their period while inactive empty farms are excluded',()=>{
  const s=initialState();s.trucks=[{...truck,end:''}];setFarmActive(s,'farm1',false);setFarmActive(s,'farm3',false);const p=period('2026-10',2);
  assert.ok(openFarmIds(s,p).includes('farm1'));assert.ok(!openFarmIds(s,p).includes('farm3'));assert.throws(()=>saveClosing(s,p,'farm3'),/inativa/);
  const c=saveClosing(s,p,'farm1','closed','2026-10-31');assert.equal(c.rows.length,1);assert.equal(c.rows[0].net,20000);assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);
});
test('current fixed monthly rule pays the agreed amount in 28, 29, 30 and 31 day months',()=>{
  for(const month of ['2026-02','2028-02','2026-04','2026-10'])for(const monthly of [30000,35000.01,.01]){
    const t={...truck,monthly,start:month+'-01',end:''},s=initialState().settings;
    const a=calculate(t,period(month,1),s,[]),b=calculate(t,period(month,2),s,[]);
    assert.equal(Math.round((a.net+b.net)*100),Math.round(monthly*100));
    if(monthly===30000){assert.equal(a.net,15000);assert.equal(b.net,15000);}
  }
});
test('partial service and discounts use the actual days of their fixed monthly fortnight',()=>{
  const s=initialState().settings,p=period('2026-10',2),t={...truck,monthly:30000,start:'2026-10-01',end:''};
  const d={id:'d',truckId:'a',start:'2026-10-20',end:'2026-10-20',reason:'Falta',note:''};
  const r=calculate(t,p,s,[d]);assert.equal(r.gross,15000);assert.equal(r.rate,937.5);assert.equal(r.net,14062.5);assert.equal(r.discount,937.5);
  assert.equal(calculate({...t,start:'2026-10-20',end:'2026-10-25'},p,s,[]).net,5625);
  assert.equal(t.monthly,30000);
});
test('switching to fixed monthly recalculates unpaid snapshots, audits prior values and preserves paid rows',()=>{
  const s=initialState();s.settings={...settings};s.trucks=[{...truck,monthly:30000,start:'2026-10-01',end:''},{...truck,id:'b',plate:'XYZ9B87',farmId:'farm2',monthly:30000,start:'2026-10-01',end:''}];
  const c=saveClosing(s,period('2026-10',2),'','legacy','2026-10-31');c.rows.find(r=>r.truckId==='b').paid={date:'2026-10-31',note:'Original'};
  const paid=structuredClone(c.rows.find(r=>r.truckId==='b'));
  applyFixedMonthlyRule(s);
  const unpaid=c.rows.find(r=>r.truckId==='a');assert.equal(unpaid.net,15000);assert.equal(unpaid.calculationSettings.mode,'half');assert.equal(c.settings.mode,'daily30');
  assert.deepEqual(c.rows.find(r=>r.truckId==='b'),paid);assert.equal(c.calculationRevisions[0].previousRows[0].net,16000);
  const before=structuredClone(s);applyFixedMonthlyRule(s);assert.deepEqual(s,before);assert.deepEqual(validateState(s),s);
});
test('a fully paid legacy closing remains identical and fixed monthly transfers conserve the total',()=>{
  const s=initialState();s.settings={...settings};s.trucks=[{...truck,monthly:30000,start:'2026-10-01',end:''}];
  const c=saveClosing(s,period('2026-10',1),'','paid','2026-10-15');c.rows[0].paid={date:'2026-10-15',note:'Original'};const old=structuredClone(c);
  applyFixedMonthlyRule(s);assert.deepEqual(s.closings[0],old);
  transferTruck(s,'a','farm2','2026-10-20','','to');const rows=draft(s,period('2026-10',2));
  assert.equal(rows.length,2);assert.equal(rows.reduce((n,r)=>n+r.net,0),15000);assert.equal(rows.reduce((n,r)=>n+r.eligibleDays,0),16);
});
test('fixed periods include leap February and the final day',()=>{
  assert.equal(period('2026-10',1).end,'2026-10-15');
  assert.equal(period('2026-10',2).end,'2026-10-31');
  assert.equal(period('2028-02',2).end,'2028-02-29');
  assert.equal(period('2026-02',2).end,'2026-02-28');
  assert.throws(()=>period('2026-13',2));
});
test('entry and termination are clipped separately to each fixed fortnight',()=>{
  let r=calculate(truck,period('2026-10',1),settings,[]);assert.equal(r.eligibleDays,10);assert.equal(r.net,13333.33);
  r=calculate(truck,period('2026-10',2),settings,[]);assert.equal(r.eligibleDays,16);assert.equal(r.net,21333.33);
  r=calculate(truck,period('2026-11',1),settings,[]);assert.equal(r.eligibleDays,10);assert.equal(r.net,13333.33);
  r=calculate(truck,period('2026-11',2),settings,[]);assert.equal(r.eligibleDays,0);assert.equal(r.net,0);
});
test('discount crossing period boundaries is counted only in the eligible intersection',()=>{
  const dd=[{id:'d',truckId:'a',start:'2026-10-14',end:'2026-10-18',reason:'Oficina',note:''}];
  const one=calculate(truck,period('2026-10',1),settings,dd),two=calculate(truck,period('2026-10',2),settings,dd);
  assert.equal(one.discountDays,2);assert.equal(two.discountDays,3);assert.equal(one.net,10666.67);assert.equal(two.net,17333.33);
  assert.equal(one.gross,one.net+one.discount);
});
test('full monthly salary reconciles in real-month and half-period modes, including February',()=>{
  for(const m of ['2026-02','2028-02','2026-10']) for(const mode of ['calendar','half']) {
    const t={...truck,start:m+'-01',end:''},s={...settings,mode};
    const a=calculate(t,period(m,1),s,[]),b=calculate(t,period(m,2),s,[]);
    assert.equal(Math.round((a.net+b.net)*100),4000000);
    if(mode==='half') {assert.equal(a.net,20000);assert.equal(b.net,20000);}
  }
});
test('a complete fixed-daily October explicitly yields 31 paid days',()=>{
  const t={...truck,start:'2026-10-01',end:''};
  assert.equal(calculate(t,period('2026-10',1),settings,[]).net+calculate(t,period('2026-10',2),settings,[]).net,41333.33);
});
test('including or excluding entry and exit dates is configurable',()=>{
  const t={...truck,start:'2026-10-06',end:'2026-10-10'};
  assert.equal(calculate(t,period('2026-10',1),settings,[]).eligibleDays,5);
  assert.equal(calculate(t,period('2026-10',1),{...settings,includeStart:false,includeEnd:false},[]).eligibleDays,3);
});
test('invalid dates, overlapping plate contracts and duplicate discount dates are rejected',()=>{
  const s=initialState();s.trucks=[truck];
  assert.throws(()=>validateTruck({...truck,id:'b'},s),/sobrepostas/);
  assert.throws(()=>validateTruck({...truck,id:'b',start:'2026-02-30'},s),/encerramento/);
  assert.throws(()=>validateTruck({...truck,monthly:0},s),/maior que zero/);
  const d={id:'d',truckId:'a',start:'2026-10-08',end:'2026-10-09',reason:'Falta',note:''};
  validateDiscount(d,s);s.discounts.push(d);
  assert.throws(()=>validateDiscount({...d,id:'e',start:'2026-10-09',end:'2026-10-10'},s),/apenas uma vez/);
  assert.throws(()=>validateDiscount({...d,id:'e',start:'2026-10-01',end:'2026-10-02'},s),/contratado/);
  validateTruck({...truck,id:'b',start:'2026-11-11',end:''},s);
});
test('all days discounted result in zero, without negative amounts',()=>{
  const dd=[{id:'d',truckId:'a',start:'2026-10-06',end:'2026-10-15',reason:'Falta',note:''}];
  const r=calculate(truck,period('2026-10',1),settings,dd);assert.equal(r.payableDays,0);assert.equal(r.net,0);assert.equal(r.gross,r.discount);
});
test('saved closing preserves values and prevents a new discount in a closed period',()=>{
  const s=initialState();s.trucks=[{...truck}];s.settings={...settings};const p=period('2026-10',1);
  const c={id:'closing',period:p,farmIds:s.farms.map(f=>f.id),settings:{...settings},closedDate:'2026-10-15',rows:structuredClone(draft(s,p))};s.closings.push(c);
  s.trucks[0].monthly=50000;s.settings.mode='half';
  assert.equal(c.rows[0].net,13333.33);assert.notEqual(draft(s,p)[0].net,c.rows[0].net);
  assert.throws(()=>validateDiscount({id:'d',truckId:'a',start:'2026-10-08',end:'2026-10-08',reason:'Falta',note:''},s),/fechada/);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);
});
test('backup schema rejects malformed values and duplicate closings',()=>{
  assert.throws(()=>validateState({schema:99}));
  const s=initialState();s.trucks=[truck];s.settings=settings;
  const c={id:'c',period:period('2026-10',1),farmIds:['farm1'],settings,closedDate:'2026-10-15',rows:draft(s,period('2026-10',1))};
  s.closings=[c,{...c,id:'d'}];assert.throws(()=>validateState(s),/duplicadas/);
});
test('CSV supports Portuguese delimiters and neutralizes formula injection',()=>{
  const output=csv([['=HYPERLINK("evil")','Nome; sobrenome','R$ 1.000,00']]);
  assert.ok(output.includes("'=HYPERLINK"));assert.ok(output.includes('"Nome; sobrenome"'));
});

test('Brazilian currency accepts typed, formatted and pasted amounts without changing their meaning',()=>{
  for(const input of ['40000','40.000','40.000,00','R$ 40.000,00']) assert.equal(parseAmount(input),40000);
  assert.equal(parseAmount('35.000,75'),35000.75);
  assert.equal(parseAmount('35000.75'),35000.75);
  assert.equal(parseAmount('0,50'),.5);
  assert.equal(amountLabel(40000),'40.000,00');
  assert.equal(amountLabel(35000.75),'35.000,75');
  for(const input of ['','abc','40,000,00','40.00.00','40.000,123','-10'])assert.ok(Number.isNaN(parseAmount(input)));
});
test('inverted dates are exposed immediately and also rejected on saving; single-day periods remain valid',()=>{
  assert.equal(dateRangeError('2026-10-08','2026-10-07'),'A data final não pode ser anterior à inicial.');
  assert.equal(dateRangeError('2026-10-08','2026-10-08'),'');
  assert.equal(dateRangeError('2026-10-08','',false),'');
  const s=initialState();s.trucks=[truck];
  assert.throws(()=>validateDiscount({id:'d',truckId:'a',start:'2026-10-08',end:'2026-10-07',reason:'Falta',note:''},s),/anterior/);
  assert.throws(()=>validateTruck({...truck,start:'2026-10-08',end:'2026-10-07'},s),/posterior/);
});
test('truck type and axle count are required for new or edited registrations, with custom counts supported',()=>{
  const s=initialState();
  for(const bodyType of ['Caçamba','Graneleiro'])for(const axles of [7,9,8])validateTruck({...truck,bodyType,axles},s,true);
  assert.throws(()=>validateTruck({...truck,bodyType:'',axles:7},s,true),/caçamba/);
  assert.throws(()=>validateTruck({...truck,bodyType:'Caçamba',axles:7.5},s,true),/inteira/);
  const r=calculate({...truck,bodyType:'Graneleiro',axles:9},period('2026-10',1),settings,[]);
  assert.equal(r.bodyType,'Graneleiro');assert.equal(r.axles,9);
});
function twoFarms() {
  const s=initialState();s.settings={...settings};s.trucks=[{...truck,bodyType:'Caçamba',axles:7},{...truck,id:'b',plate:'XYZ9B87',farmId:'farm2',bodyType:'Graneleiro',axles:9}];return s;
}
test('closing one farm freezes its values while other farms and discounts remain editable',()=>{
  const s=twoFarms(),p=period('2026-10',1);saveClosing(s,p,'farm1','c1','2026-10-15');
  assert.ok(farmClosing(s,p,'farm1'));assert.equal(farmClosing(s,p,'farm2'),undefined);
  s.trucks.forEach(t=>t.monthly=50000);
  const rr=periodRows(s,p);assert.equal(rr.find(r=>r.truckId==='a').net,13333.33);assert.equal(rr.find(r=>r.truckId==='b').net,16666.67);
  const d={id:'d',truckId:'b',start:'2026-10-08',end:'2026-10-08',reason:'Falta',note:''};validateDiscount(d,s);s.discounts.push(d);
  assert.equal(discountLocked(d,s),false);
  assert.throws(()=>validateDiscount({...d,id:'d2',truckId:'a'},s),/fechada/);
  assert.throws(()=>saveClosing(s,p,'farm1','c2'),/já está fechada/);
  saveClosing(s,p,'farm2','c2','2026-10-15');assert.deepEqual(validateState(s),s);
});
test('close-all includes only open farms and preserves an existing paid closing',()=>{
  const s=twoFarms(),p=period('2026-10',1);const original=saveClosing(s,p,'farm1','c1','2026-10-15');original.rows[0].paid={date:'2026-10-15',note:'Pago'};
  const before=structuredClone(original);const all=saveClosing(s,p,'','c2','2026-10-15');
  assert.ok(!all.farmIds.includes('farm1'));assert.deepEqual(original,before);
  assert.equal(periodRows(s,p).length,2);assert.deepEqual(validateState(s),s);
  assert.throws(()=>saveClosing(s,p,'','c3'),/já estão fechadas/);
});
test('reopening one farm from a combined closing preserves another farm payment and snapshot',()=>{
  const s=twoFarms(),p=period('2026-10',1);const c=saveClosing(s,p,'','combined','2026-10-15');
  c.rows.find(r=>r.truckId==='b').paid={date:'2026-10-15',note:'Pago'};const b=structuredClone(c.rows.find(r=>r.truckId==='b'));
  reopenClosing(s,p,'farm1');assert.equal(farmClosing(s,p,'farm1'),undefined);assert.deepEqual(farmClosing(s,p,'farm2').rows[0],b);
  assert.equal(periodRows(s,p).find(r=>r.truckId==='a').closed,false);
  assert.throws(()=>reopenClosing(s,p,'farm2'),/pagamentos/);
  saveClosing(s,p,'farm1','new','2026-10-16');assert.deepEqual(validateState(s),s);
});
test('existing schema-1 data and backups migrate without losing dates, amounts or payments',()=>{
  const legacy=twoFarms(),p=period('2026-10',1);legacy.schema=1;
  legacy.trucks.forEach(t=>{delete t.bodyType;delete t.axles;});
  const originalRows=draft(legacy,p);originalRows[0].paid={date:'2026-10-15',note:'Comprovante original'};
  legacy.closings=[{id:'legacy',period:p,settings,closedDate:'2026-10-15',rows:originalRows}];
  const migrated=validateState(JSON.parse(JSON.stringify(legacy)));
  assert.equal(migrated.schema,SCHEMA);assert.equal(migrated.trucks.length,2);assert.equal(migrated.trucks[0].bodyType,'');assert.equal(migrated.trucks[0].axles,null);
  assert.equal(migrated.closings[0].rows[0].net,originalRows[0].net);assert.deepEqual(migrated.closings[0].rows[0].paid,originalRows[0].paid);
  assert.deepEqual(migrated.closings[0].farmIds,migrated.farms.map(f=>f.id));
  assert.deepEqual(validateState(migrated),migrated);
  assert.equal(legacy.schema,1);
});
test('a closed contract cannot be moved to another farm, while new late registrations are allowed',()=>{
  const s=twoFarms(),p=period('2026-10',1);saveClosing(s,p,'farm1','c1','2026-10-15');
  assert.throws(()=>validateTruck({...s.trucks[0],farmId:'farm2'},s,true),/Transferir fazenda/);
  validateTruck({...truck,id:'new',plate:'NOV1A23',farmId:'farm1',bodyType:'Caçamba',axles:7},s,true);
});
test('a late truck gets a complementary closing without changing original paid records',()=>{
  const s=twoFarms(),p=period('2026-10',1),old=saveClosing(s,p,'','base','2026-10-06');
  old.rows.forEach(r=>r.paid={date:'2026-10-06',note:'Pagamento original'});
  const original=structuredClone(old),late={...truck,id:'late',plate:'NOV1A23',bodyType:'Caçamba',axles:9,monthly:35000};
  validateTruck(late,s,true);s.trucks.push(late);
  let rr=periodRows(s,p);assert.equal(rr.length,3);assert.equal(rr.find(r=>r.truckId==='late').closed,false);assert.equal(rr.find(r=>r.truckId==='late').complementary,true);
  const d={id:'late-discount',truckId:'late',start:'2026-10-08',end:'2026-10-08',reason:'Oficina',note:''};
  validateDiscount(d,s);s.discounts.push(d);assert.equal(discountLocked(d,s),false);
  const complement=saveClosing(s,p,'farm1','supplement','2026-10-06');
  assert.equal(complement.kind,'complement');assert.equal(complement.rows.length,1);assert.equal(complement.rows[0].net,10500);assert.deepEqual(old,original);
  assert.equal(discountLocked(d,s),true);assert.throws(()=>saveClosing(s,p,'farm1','duplicate'),/não tem novas placas/);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);
  reopenClosing(s,p,'','supplement');assert.deepEqual(s.closings,[original]);assert.equal(periodRows(s,p).find(r=>r.truckId==='late').closed,false);
  assert.deepEqual(validateState(s),s);
});
test('a new contract starting after the current fortnight appears only in its eligible period',()=>{
  const s=twoFarms(),first=period('2026-10',1),second=period('2026-10',2);saveClosing(s,first,'','base','2026-10-06');
  const late={...truck,id:'future',plate:'NOV1A23',bodyType:'Graneleiro',axles:7,start:'2026-10-16',end:''};
  validateTruck(late,s,true);s.trucks.push(late);
  assert.ok(!periodRows(s,first).some(r=>r.truckId==='future'));
  const future=periodRows(s,second).find(r=>r.truckId==='future');assert.equal(future.closed,false);assert.equal(future.eligibleDays,16);assert.equal(future.complementary,false);
});
test('old farm changes cannot generate a second payment when another farm is reopened',()=>{
  const s=twoFarms(),p=period('2026-10',1);saveClosing(s,p,'','old','2026-10-15');
  s.trucks[0].farmId='farm2';
  reopenClosing(s,p,'farm2');
  const rr=periodRows(s,p);assert.equal(rr.filter(r=>r.truckId==='a').length,1);
  const next=saveClosing(s,p,'farm2','new','2026-10-15');assert.ok(next.rows.every(r=>r.truckId!=='a'));
  assert.deepEqual(validateState(s),s);
});
function transferFixture(start='2026-10-01',end='') {
  const s=initialState();s.settings={...settings};s.trucks=[{...truck,start,end,bodyType:'Caçamba',axles:9}];return s;
}
test('a dated transfer preserves the truck information and divides costs between origin and destination',()=>{
  const s=transferFixture(),p=period('2026-10',1);
  const to=transferTruck(s,'a','farm2','2026-10-10','Remanejamento','to');
  assert.equal(s.trucks[0].end,'2026-10-09');assert.equal(to.start,'2026-10-10');assert.equal(to.monthly,40000);assert.equal(to.plate,truck.plate);assert.equal(to.driver,truck.driver);
  const rr=draft(s,p);assert.equal(rr.find(r=>r.farmId==='farm1').eligibleDays,9);assert.equal(rr.find(r=>r.farmId==='farm2').eligibleDays,6);assert.equal(rr.reduce((n,r)=>n+r.net,0),20000);
  assert.equal(s.trucks[0].transferOut.toTruckId,'to');assert.equal(to.transferIn.fromTruckId,'a');assert.deepEqual(validateState(s),s);
});
test('transfer boundaries do not apply the real entry or termination exclusion twice',()=>{
  for(const includeStart of [true,false])for(const includeEnd of [true,false]){
    const s=transferFixture('2026-10-01','2026-10-15');s.settings={...settings,includeStart,includeEnd};const p=period('2026-10',1),before=draft(s,p)[0];
    transferTruck(s,'a','farm2','2026-10-10','','to');const after=draft(s,p);
    assert.equal(after.reduce((n,r)=>n+r.eligibleDays,0),before.eligibleDays);assert.equal(Math.round(after.reduce((n,r)=>n+r.net,0)*100),Math.round(before.net*100));
  }
});
test('discounts before, after and across a transfer retain their dates and total deducted days',()=>{
  const s=transferFixture(),p=period('2026-10',1);s.discounts=[
    {id:'before',truckId:'a',start:'2026-10-03',end:'2026-10-04',reason:'Falta',note:'Anterior'},
    {id:'cross',truckId:'a',start:'2026-10-08',end:'2026-10-12',reason:'Oficina',note:'Manutenção'},
    {id:'after',truckId:'a',start:'2026-10-14',end:'2026-10-15',reason:'Falta',note:'Posterior'}
  ];const before=draft(s,p)[0];transferTruck(s,'a','farm2','2026-10-10','','to');
  const rr=draft(s,p);assert.equal(rr.reduce((n,r)=>n+r.discountDays,0),9);assert.equal(rr.reduce((n,r)=>n+r.net,0),before.net);
  assert.equal(s.discounts.find(d=>d.id==='before').truckId,'a');assert.equal(s.discounts.find(d=>d.id==='after').truckId,'to');
  assert.equal(s.discounts.find(d=>d.id==='cross').end,'2026-10-09');assert.ok(s.discounts.some(d=>d.truckId==='to'&&d.start==='2026-10-10'&&d.end==='2026-10-12'));
  assert.deepEqual(validateState(s),s);
});
test('a transfer after a paid fortnight preserves its snapshot including an earlier crossing discount',()=>{
  const s=transferFixture();s.discounts=[{id:'cross',truckId:'a',start:'2026-10-14',end:'2026-10-18',reason:'Oficina',note:'Original'}];
  const c=saveClosing(s,period('2026-10',1),'','paid','2026-10-15');c.rows[0].paid={date:'2026-10-15',note:'Comprovante'};const before=structuredClone(c);
  transferTruck(s,'a','farm2','2026-10-16','','to');assert.deepEqual(s.closings[0],before);assert.equal(s.discounts.find(d=>d.id==='cross').end,'2026-10-15');
  const future=draft(s,period('2026-10',2));assert.equal(future.length,1);assert.equal(future[0].farmId,'farm2');assert.equal(future[0].discountDays,3);assert.deepEqual(validateState(s),s);
});
test('transfers affecting a saved or paid period are blocked without changing any data',()=>{
  for(const paid of [false,true]){
    const s=transferFixture(),c=saveClosing(s,period('2026-10',1),'','closed','2026-10-06');if(paid)c.rows[0].paid={date:'2026-10-06',note:'Pago'};
    const before=structuredClone(s),preview=previewTransfer(s,'a','farm2','2026-10-10');assert.equal(preview.canTransfer,false);assert.equal(preview.conflicts[0].paid,paid);
    assert.throws(()=>transferTruck(s,'a','farm2','2026-10-10','','to'),/fechamento salvo/);assert.deepEqual(s,before);
  }
});
test('successive transfers conserve the monthly calculation and reconcile rounding cents',()=>{
  for(const monthly of [40000,35000,.01,.05]){
    const s=transferFixture();s.trucks[0].monthly=monthly;
    transferTruck(s,'a','farm2','2026-10-06','','second');transferTruck(s,'second','farm1','2026-10-11','','third');
    const rr=draft(s,period('2026-10',1));assert.equal(rr.reduce((n,r)=>n+r.eligibleDays,0),15);assert.equal(Math.round(rr.reduce((n,r)=>n+r.net,0)*100),Math.round(Math.round(monthly/2*100)));
    assert.ok(rr.every(r=>r.net>=0&&r.gross>=r.net&&r.discount>=0));assert.deepEqual(validateState(s),s);
  }
});
test('February and different daily rules keep the total after transfers',()=>{
  for(const mode of ['half','calendar','daily30']){
    const s=transferFixture('2026-02-01');s.settings.mode=mode;const p=period('2026-02',2),before=draft(s,p)[0].net;
    transferTruck(s,'a','farm2','2026-02-20','','second');transferTruck(s,'second','farm1','2026-02-25','','third');
    assert.equal(Math.round(draft(s,p).reduce((n,r)=>n+r.net,0)*100),Math.round(before*100));
  }
});
test('linked transfer dates and farms remain consistent during edits and backup restoration',()=>{
  const s=transferFixture('2026-10-01','2026-11-10');transferTruck(s,'a','farm2','2026-10-10','','to');
  assert.equal(s.trucks[1].end,'2026-11-10');
  assert.throws(()=>validateTruck({...s.trucks[0],end:'2026-10-10'},s),/vinculadas/);
  assert.throws(()=>validateTruck({...s.trucks[1],start:'2026-10-11'},s),/vinculadas/);
  assert.throws(()=>validateTruck({...s.trucks[1],farmId:'farm3'},s),/vinculadas/);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);
});
test('ending activities closes only that plate up to its last service day and applies discounts',()=>{
  const s=twoFarms();s.trucks[0].start='2026-10-01';s.discounts=[{id:'d',truckId:'a',start:'2026-10-07',end:'2026-10-08',reason:'Falta',note:''}];
  const preview=previewEndActivities(s,'a','2026-10-10');assert.equal(preview.canEnd,true);assert.equal(preview.balance,10666.67);
  const c=endActivities(s,'a','2026-10-10','Dispensado','end','2026-10-06');
  assert.equal(c.rows.length,1);assert.equal(c.rows[0].truckId,'a');assert.equal(c.rows[0].end,'2026-10-10');assert.equal(c.rows[0].payableDays,8);assert.equal(c.kind,'activity-end');
  assert.equal(s.trucks[0].end,'2026-10-10');assert.equal(s.trucks[0].serviceEnded.date,'2026-10-10');assert.equal(periodRows(s,period('2026-10',1)).find(r=>r.truckId==='b').closed,false);
  assert.ok(!draft(s,period('2026-10',2)).some(r=>r.truckId==='a'));assert.deepEqual(validateState(s),s);
});
test('ending revises its unpaid saved amount and preserves another plate paid record',()=>{
  const s=twoFarms();s.trucks[0].start='2026-10-01';const original=saveClosing(s,period('2026-10',1),'','original','2026-10-06');original.rows.find(r=>r.truckId==='b').paid={date:'2026-10-06',note:'Preservar'};
  const other=structuredClone(original.rows.find(r=>r.truckId==='b'));
  const p=previewEndActivities(s,'a','2026-10-10');assert.equal(p.revisions.length,1);assert.equal(p.total,13333.33);
  endActivities(s,'a','2026-10-10','','end','2026-10-06');
  assert.deepEqual(s.closings.find(c=>c.id==='original').rows.find(r=>r.truckId==='b'),other);
  assert.equal(s.trucks[0].serviceEnded.revisions[0].row.net,20000);assert.equal(periodRows(s,period('2026-10',1)).find(r=>r.truckId==='a').net,13333.33);assert.deepEqual(validateState(s),s);
});
test('ending that changes an already paid period is blocked without changing the data',()=>{
  const s=transferFixture(),c=saveClosing(s,period('2026-10',1),'','paid','2026-10-06');c.rows[0].paid={date:'2026-10-06',note:'Original'};
  const before=structuredClone(s);assert.equal(previewEndActivities(s,'a','2026-10-10').canEnd,false);
  assert.throws(()=>endActivities(s,'a','2026-10-10','','end'),/pagamento registrado/);assert.deepEqual(s,before);
});
test('a paid fortnight with identical covered dates stays intact when termination is registered',()=>{
  const s=transferFixture(),c=saveClosing(s,period('2026-10',1),'','paid','2026-10-06');c.rows[0].paid={date:'2026-10-06',note:'Original'};const before=structuredClone(c);
  assert.equal(previewEndActivities(s,'a','2026-10-15').canEnd,true);endActivities(s,'a','2026-10-15','Fim','','2026-10-06');
  assert.deepEqual(s.closings,[before]);assert.equal(s.trucks[0].end,'2026-10-15');assert.equal(s.trucks[0].serviceEnded.closingId,'paid');assert.deepEqual(validateState(s),s);
});
test('ending clips crossing discounts and archives records beyond the last service day',()=>{
  const s=transferFixture();s.discounts=[{id:'cross',truckId:'a',start:'2026-10-08',end:'2026-10-12',reason:'Oficina',note:'Original'},{id:'future',truckId:'a',start:'2026-10-14',end:'2026-10-15',reason:'Falta',note:''}];
  endActivities(s,'a','2026-10-10','','end','2026-10-06');assert.equal(s.discounts.length,1);assert.equal(s.discounts[0].end,'2026-10-10');
  assert.equal(s.trucks[0].serviceEnded.cancelledDiscounts.length,2);assert.equal(s.trucks[0].serviceEnded.cancelledDiscounts[0].end,'2026-10-12');assert.equal(s.closings[0].rows[0].discountDays,3);assert.deepEqual(validateState(s),s);
});
test('termination closes the final fortnight selected by date and keeps earlier periods unchanged',()=>{
  const s=transferFixture(),c=saveClosing(s,period('2026-10',1),'','old','2026-10-15');c.rows[0].paid={date:'2026-10-15',note:'Antes'};const old=structuredClone(c);
  endActivities(s,'a','2026-11-10','','final','2026-11-10');assert.deepEqual(s.closings.find(c=>c.id==='old'),old);assert.equal(s.closings.find(c=>c.id==='final').period.key,'2026-11-1');assert.equal(s.closings.find(c=>c.id==='final').rows[0].end,'2026-11-10');assert.deepEqual(validateState(s),s);
});
test('termination after a transfer closes all unpaid parts of that plate and conserves rounding',()=>{
  const s=transferFixture();transferTruck(s,'a','farm2','2026-10-06','','to');
  const p=previewEndActivities(s,'a','2026-10-10');assert.equal(p.truckId,'to');assert.equal(p.rows.length,2);assert.equal(p.total,13333.33);
  const c=endActivities(s,'a','2026-10-10','','end','2026-10-06');assert.equal(c.rows.length,2);assert.equal(c.farmIds.length,2);assert.equal(s.trucks.find(t=>t.id==='to').end,'2026-10-10');assert.deepEqual(validateState(s),s);
});
test('termination preserves a paid transferred part while balancing cents in the remainder',()=>{
  const s=transferFixture();transferTruck(s,'a','farm2','2026-10-06','','to');const c=saveClosing(s,period('2026-10',1),'farm1','paid','2026-10-06');c.rows[0].paid={date:'2026-10-06',note:'Primeira parte'};const old=structuredClone(c);
  const p=previewEndActivities(s,'to','2026-10-10');assert.equal(p.total,13333.33);assert.equal(p.paid,6666.67);assert.equal(p.balance,6666.66);
  endActivities(s,'to','2026-10-10','','end','2026-10-06');assert.deepEqual(s.closings.find(c=>c.id==='paid'),old);assert.deepEqual(validateState(s),s);
});
test('a zero-day ending remains explicitly closed and repeated confirmation does not duplicate billing',()=>{
  const s=transferFixture();s.settings.includeStart=false;s.settings.includeEnd=false;
  const c=endActivities(s,'a','2026-10-01','Nota','end','2026-10-06');assert.equal(c.rows[0].net,0);assert.equal(c.rows[0].eligibleDays,0);
  const before=structuredClone(s);endActivities(s,'a','2026-10-01','Nota','again','2026-10-06');assert.deepEqual(s,before);assert.deepEqual(validateState(s),s);
  assert.throws(()=>previewEndActivities(s,'a','2026-09-30'),/posterior/);
});
