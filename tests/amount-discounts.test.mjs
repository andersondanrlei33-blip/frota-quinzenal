import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,period,calculate,draft,validateDiscount,validateState,saveClosing,periodRows,transferTruck,endActivities,round,applyFixedMonthlyRule} from '../server/engine.js';
import {executeCommand} from '../server/commands.js';
import {createReport,reportMarkup} from '../frontend/reports.js';
const truck={id:'a',plate:'ABC1D23',driver:'Motorista',carrier:'Transportador',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''};
const amount=(id='cash',date='2026-10-07',value=500)=>({id,truckId:'a',kind:'amount',start:date,end:date,reason:'Valor',amount:value,note:'Adiantamento combinado'});
const fleet=()=>({...initialState(),trucks:[{...truck}]});
const actor={userId:'admin-test',role:'admin'};
test('cash discounts belong to one fortnight and leave payable days intact while adding to day deductions',()=>{
 const s=fleet(),cash=amount('cash','2026-10-07',500.25);validateDiscount(cash,s);s.discounts=[cash];
 const r=calculate(truck,period('2026-10',1),s.settings,s.discounts,s.farms);assert.equal(r.eligibleDays,15);assert.equal(r.payableDays,15);assert.equal(r.discountDays,0);assert.equal(r.discount,500.25);assert.equal(r.net,14499.75);assert.equal(r.events[0].count,0);
 assert.equal(draft(s,period('2026-10',2))[0].discount,0);
 const days={id:'days',truckId:'a',start:'2026-10-07',end:'2026-10-08',reason:'Falta',note:''};validateDiscount(days,s);s.discounts.push(days);
 assert.equal(draft(s,period('2026-10',1))[0].net,12499.75);assert.equal(draft(s,period('2026-10',1))[0].discountDays,2);assert.deepEqual(validateState(s),s);
});
test('server requires a monetary reason, positive cents and a single in-contract date',()=>{
 const s=fleet();for(const amountValue of [0,-1,NaN,Infinity,'500',0.001])assert.throws(()=>validateDiscount({...amount(),amount:amountValue},s),/valor/);
 assert.throws(()=>validateDiscount({...amount(),note:'   '},s),/obrigatoriamente/);
 assert.throws(()=>validateDiscount({...amount(),end:'2026-10-08'},s),/única data/);
 assert.throws(()=>validateDiscount({...amount(),start:'2026-09-30',end:'2026-09-30'},s),/contratado/);
 assert.throws(()=>validateDiscount({...amount(),kind:'invented'},s),/tipo/);
 assert.throws(()=>validateDiscount({...amount(),kind:'days'},s),/por valor/);
 const saved=executeCommand(s,{type:'discount.save',payload:amount()},actor).state;assert.equal(saved.discounts[0].amount,500);assert.equal(saved.discounts[0].kind,'amount');
 assert.throws(()=>executeCommand(s,{type:'discount.save',payload:{...amount(),note:''}},actor),/obrigatoriamente/);assert.deepEqual(s,fleet());
});
test('multiple cash discounts may coexist on a day, but total deductions cannot silently exceed earnings',()=>{
 const s=fleet();s.discounts=[amount('one','2026-10-07',7000)];validateDiscount(amount('two','2026-10-07',8000),s);s.discounts.push(amount('two','2026-10-07',8000));assert.equal(draft(s,period('2026-10',1))[0].net,0);
 assert.throws(()=>validateDiscount(amount('three','2026-10-07',0.01),s),/excedem/);
 assert.throws(()=>validateDiscount({id:'days',truckId:'a',start:'2026-10-08',end:'2026-10-08',reason:'Falta',note:''},s),/excedem/);
 const changed=structuredClone(s);changed.trucks[0].monthly=20000;assert.throws(()=>validateState(changed),/excedem/);
});
test('transfers keep each monetary deduction on its dated assignment and reconcile all cents',()=>{
 const s=fleet();s.trucks[0].monthly=30000.01;s.discounts=[amount('one','2026-10-04',500.25),amount('two','2026-10-07',333.33),amount('three','2026-10-14',200.01)];
 transferTruck(s,'a','farm2','2026-10-06','','b');transferTruck(s,'b','farm3','2026-10-11','','c');
 assert.deepEqual(s.discounts.map(d=>d.truckId),['a','b','c']);assert.equal(s.discounts.length,3);const p=period('2026-10',1),rows=draft(s,p);assert.equal(round(rows.reduce((n,r)=>n+r.net,0)),13966.42);assert.equal(round(rows.reduce((n,r)=>n+r.discount,0)),1033.59);
 saveClosing(s,p,'farm2','middle','2026-10-15');saveClosing(s,p,'farm1','first','2026-10-15');saveClosing(s,p,'farm3','last','2026-10-15');assert.equal(round(periodRows(s,p).reduce((n,r)=>n+r.net,0)),13966.42);assert.deepEqual(validateState(s),s);
});
test('paid monetary snapshots survive later rate changes and discounts remain locked',()=>{
 const s=fleet();s.discounts=[amount('cash','2026-10-07',1000)];const p=period('2026-10',1),c=saveClosing(s,p,'farm1','paid','2026-10-15');c.rows[0].paid={date:'2026-10-15',note:''};const original=structuredClone(c);
 s.trucks[0].monthly=1000;assert.deepEqual(validateState(s),s);applyFixedMonthlyRule(s);assert.deepEqual(s.closings[0],original);assert.equal(periodRows(s,p)[0].net,14000);
 assert.throws(()=>validateDiscount({...s.discounts[0],amount:800},s),/fechad/);
});
test('ending activities preserves an eligible cash deduction and archives a future one',()=>{
 const s=fleet();s.discounts=[amount('inside','2026-10-07',500),amount('future','2026-10-14',750)];const closing=endActivities(s,'a','2026-10-10','','end','2026-10-10');
 assert.equal(closing.rows[0].net,9500);assert.equal(closing.rows[0].payableDays,10);assert.equal(s.discounts.length,1);assert.equal(s.trucks[0].serviceEnded.cancelledDiscounts[0].amount,750);assert.deepEqual(validateState(s),s);
});
test('report prints the monetary value and mandatory explanation from the saved snapshot',()=>{
 const s=fleet();s.discounts=[{...amount('cash','2026-10-07',500.25),note:'Adiantamento <combinado>'}];const p=period('2026-10',1),c=saveClosing(s,p,'farm1','closed','2026-10-15');c.rows[0].paid={date:'2026-10-15',note:''};s.discounts[0].note='Alteração posterior';
 const report=createReport(s,p),html=reportMarkup(report);assert.equal(report.total,14499.75);assert.match(html,/500,25/);assert.match(html,/Desconto por valor em 07\/10\/2026/);assert.match(html,/Motivo: Adiantamento &lt;combinado&gt;/);assert.doesNotMatch(html,/Alteração posterior/);
});
