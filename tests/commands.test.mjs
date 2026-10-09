import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,period,saveClosing,validateState} from '../server/engine.js';
import {executeCommand} from '../server/commands.js';
const actor={userId:'admin-test',role:'admin'};
const truck={id:'a',plate:'ABC1D23',driver:'Motorista',carrier:'Transportador',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentDetails:{method:'pix',holder:'Motorista',document:'12345678901',pixKey:'motorista@example.com'}};
test('server commands calculate amounts themselves and reject client supplied paid values',()=>{
  let state=initialState();state=executeCommand(state,{type:'truck.save',payload:{...truck,net:1,paid:{date:'2026-10-01'}}},actor).state;
  const before=structuredClone(state),closed=executeCommand(state,{type:'period.close',payload:{month:'2026-10',half:1}},actor);
  assert.equal(closed.state.closings[0].rows[0].net,15000);assert.equal(closed.state.closings[0].rows[0].paid,null);assert.deepEqual(state,before);assert.equal(closed.audit.actorId,actor.userId);
});
test('server permissions deny anonymous, viewers and operator administrative writes',()=>{
  const command={type:'farm.remove',payload:{id:'farm3'}};
  assert.throws(()=>executeCommand(initialState(),command,null),/permissão/);
  assert.throws(()=>executeCommand(initialState(),command,{userId:'viewer',role:'viewer'}),/permissão/);
  assert.throws(()=>executeCommand(initialState(),command,{userId:'operator',role:'operator'}),/administrador/);
});
test('server command can reopen one truck in a multi-truck closing only',()=>{
  let state=initialState();state.trucks=[truck,{...truck,id:'b',plate:'DEF1G23',farmId:'farm2'}];
  const closing=saveClosing(state,period('2026-10',1),'','reopen-single','2026-10-15');
  const result=executeCommand(state,{type:'period.reopen-truck',payload:{month:'2026-10',half:1,closingId:closing.id,truckId:'a'}},actor);
  assert.deepEqual(result.state.closings[0].rows.map(row=>row.truckId),['b']);
  assert.deepEqual(state.closings[0].rows.map(row=>row.truckId),['a','b']);
});
test('server commands preserve paid snapshots and reject discounts in closed periods',()=>{
  const state=initialState();state.trucks=[truck];const c=saveClosing(state,period('2026-10',1),'','paid','2026-10-06');c.rows[0].paid={date:'2026-10-06',note:'Original'};const before=structuredClone(state);
  assert.throws(()=>executeCommand(state,{type:'discount.save',payload:{truckId:'a',start:'2026-10-07',end:'2026-10-07',reason:'Falta',note:''}},actor),/fechad/);
  const result=executeCommand(state,{type:'farm.status',payload:{id:'farm1',active:false}},actor);assert.deepEqual(result.state.closings,state.closings);assert.deepEqual(state,before);
});
test('a new invoice is explicitly unlocked while the paid invoice snapshot remains immutable',()=>{
  const state=initialState();state.trucks=[truck];
  const first=saveClosing(state,period('2026-10',1),'farm1','first','2026-10-06');first.rows[0].paid={date:'2026-10-06',note:'Pagamento confirmado'};
  const original=structuredClone(first);state.trucks.push({...truck,id:'late',plate:'XYZ9B87',start:'2026-10-08'});
  assert.throws(()=>executeCommand(state,{type:'period.close',payload:{month:'2026-10',half:1,farmId:'farm1'}},actor),/Reabra a quinzena/);
  const unlocked=executeCommand(state,{type:'period.reopen-invoice',payload:{month:'2026-10',half:1,farmId:'farm1'}},actor).state;
  assert.deepEqual(unlocked.closings[0],original);
  const next=executeCommand(unlocked,{type:'period.close',payload:{month:'2026-10',half:1,farmId:'farm1'}},actor).state;
  assert.deepEqual(next.closings[0],original);assert.equal(next.closings.length,2);assert.equal(next.closings[1].rows[0].truckId,'late');
  assert.deepEqual(validateState(next),next);
});
test('server records and reverses the payment for the selected truck row',()=>{
  const state=initialState();state.trucks=[truck];const closing=saveClosing(state,period('2026-10',1),'','closing-payment','2026-10-06');
  const requested=executeCommand(state,{type:'payment.request',payload:{month:'2026-10',half:1}},actor).state,requestId=requested.paymentRequests[0].id;
  const carrier={userId:'carrier-test',role:'operator',party:'carrier',companyId:'company-one'},receipt={id:'receipt-test',companyId:'company-one',uploadedBy:'carrier-test',requestId,name:'receipt.pdf',mime:'application/pdf',size:100};
  const command={type:'payment.record',payload:{requestId,date:'2026-10-06',note:'Transferência'}};
  const paid=executeCommand(requested,command,carrier,{receipt}).state;
  assert.equal(paid.closings[0].rows[0].paid.date,'2026-10-06');assert.equal(state.closings[0].rows[0].paid,null);
  assert.throws(()=>executeCommand(paid,command,carrier,{receipt}),/disponível/);
  assert.throws(()=>executeCommand(requested,{...command,payload:{...command.payload,requestId:'missing'}},carrier,{receipt}),/não encontrada/);
  const undone=executeCommand(paid,{type:'payment.undo',payload:{requestId,note:'Corrigir referência'}},carrier).state;
  assert.equal(undone.closings[0].rows[0].paid,null);assert.equal(undone.closings[0].rows[0].net,15000);
});

